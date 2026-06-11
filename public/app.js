// Elementos DOM
const cameraBtn = document.getElementById('cameraBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraVideo = document.getElementById('cameraVideo');
const captureBtn = document.getElementById('captureBtn');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const previewContainer = document.getElementById('previewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeBtn = document.getElementById('removeBtn');
const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
const resultSection = document.getElementById('resultSection');
const resultImage = document.getElementById('resultImage');
const loadingOverlay = document.getElementById('loadingOverlay');
const downloadBtn = document.getElementById('downloadBtn');
const newBtn = document.getElementById('newBtn');
const toast = document.getElementById('toast');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const countdownEl = document.getElementById('countdown');

let cameraStream = null;

// Event Listeners
generateBtn.addEventListener('click', generateImage);
downloadBtn.addEventListener('click', downloadImage);
newBtn.addEventListener('click', resetForm);
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileUpload);
cameraBtn.addEventListener('click', async () => {
    cameraModal.style.display = 'block';
    
    // 1. Verificar soporte básico y contexto seguro
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tu navegador no permite acceso a la cámara. Asegúrate de usar HTTPS o localhost.');
        cameraModal.style.display = 'none';
        return;
    }

    try {
        // 2. Intentar obtener cámara (preferencia: frontal)
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        cameraVideo.srcObject = cameraStream;
    } catch (err) {
        console.error('Error de cámara:', err);
        
        // 3. Mensajes de error más claros
        let msg = 'No se pudo acceder a la cámara.';
        if (err.name === 'NotFoundError' || err.message.includes('not found')) {
            msg = 'No se detectó ninguna cámara conectada. Si estás en PC, conecta una webcam.';
        } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            msg = 'Permiso denegado. Debes permitir el acceso a la cámara en la barra de dirección.';
        } else if (err.name === 'NotReadableError') {
            msg = 'La cámara está siendo usada por otra aplicación (Zoom, Meet, etc).';
        }
        
        alert(`${msg}\n\nDetalle técnico: ${err.message || err.name}`);
        cameraModal.style.display = 'none';
    }
});
captureBtn.addEventListener('click', startCountdown);
closeCameraBtn.addEventListener('click', closeCamera);

// Funciones
function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

function checkFormValid() {
    // Verifica si hay imagen en el preview
    const hasImage = imagePreview.src && imagePreview.src.startsWith('data:image');
    generateBtn.disabled = !hasImage;
}

// Manejar subida de archivo desde galería
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            previewContainer.style.display = 'block';
            checkFormValid();
        };
        reader.readAsDataURL(file);
    }
}

// Iniciar cuenta regresiva
function startCountdown() {
    let count = 3;
    countdownEl.style.display = 'block';
    countdownEl.textContent = count;
    
    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            countdownEl.textContent = count;
        } else {
            clearInterval(timer);
            countdownEl.style.display = 'none';
            captureImage();
        }
    }, 1000);
}

// Actualiza el preview y validación al capturar imagen
function captureImage() {
    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    imagePreview.src = dataUrl;
    previewContainer.style.display = 'block';
    cameraModal.style.display = 'none';
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    // Asegura que se valide el formulario después de capturar
    checkFormValid();
}

// Quitar imagen capturada
removeBtn.addEventListener('click', () => {
    imagePreview.src = '';
    previewContainer.style.display = 'none';
    checkFormValid();
});

// Generar imagen usando la imagen capturada (base64)
async function generateImage() {
    if (!imagePreview.src || !imagePreview.src.startsWith('data:image')) {
        showToast('La imagen es requerida', 'error');
        imagePreview.classList.add('required');
        setTimeout(() => imagePreview.classList.remove('required'), 1500);
        return;
    }

    // Construir el prompt con los datos de camiseta y nombre
    const nombre = window.nombreUsuario || 'Usuario';
    const camiseta = window.camisetaSeleccionada;
    const nombreCamiseta = camiseta ? camiseta.name : 'la seleccionada';
    const estiloMarco = window.marcoSeleccionado || 'verde y dorado';
    
    const prompt = `Usa la primera imagen (la foto de la persona) como base principal.
Mantén mi identidad facial realista y reconocible.

La segunda imagen es la camiseta de fútbol de ${nombreCamiseta} que DEBES usar.
Cambia la ropa de la persona por EXACTAMENTE esa camiseta de la segunda imagen:
reproduce fielmente sus colores, diseño, franjas, escudo y todos sus detalles.
NO inventes otra camiseta ni cambies su diseño.
IMPORTANTE: no agregues logos de patrocinadores, marcas deportivas
ni publicidad que no aparezcan en la camiseta de referencia.

Crea una carta de jugador de fútbol estilo FIFA Ultimate Team,
diseño premium y profesional.

Agrega un marco tipo carta ${estiloMarco},
valoración del jugador en la parte superior,
nombre (${nombre}) y posición debajo.

Incluye la bandera de ${nombreCamiseta} en algún lugar visible de la carta.

Fondo de estadio con iluminación cinematográfica,
estilo póster deportivo realista,
alta calidad, ultra detallado,
no caricatura, no anime.`;

    promptInput.value = prompt;

    loadingOverlay.style.display = 'flex';

    try {
        const formData = new FormData();
        // Convierte el base64 a archivo antes de enviar
        const file = dataURLtoFile(imagePreview.src, 'captured.png');
        formData.append('image', file);
        formData.append('prompt', prompt);
        // Enviar el archivo de la camiseta seleccionada para usarla como referencia visual
        if (camiseta && camiseta.file) {
            formData.append('shirtFile', camiseta.file);
        }

        const response = await fetch('/api/generate', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        console.log('Respuesta del servidor:', data);

        if (!response.ok) {
            throw new Error(data.error || 'Error al generar la imagen');
        }

        resultImage.src = data.image;
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('¡Imagen generada exitosamente! 🎉', 'success');
        
        // Lanzar celebración de fútbol
        if (window.confetti) {
            // 1. Lluvia de balones de fútbol
            const scalar = 4;
            const soccer = confetti.shapeFromText({ text: '⚽', scalar });
            
            window.confetti({
                particleCount: 30,
                spread: 100,
                origin: { y: 0.6 },
                shapes: [soccer],
                scalar: scalar,
                gravity: 0.7,
                ticks: 300 // Duran más tiempo en pantalla
            });

            // 2. Confeti complementario (Oro, Blanco, Negro)
            window.confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#FFD700', '#FFFFFF', '#000000'], // Colores premium
                shapes: ['circle'],
                gravity: 0.6
            });
        }
        
        // Mostrar QR con URL de descarga
        console.log('QR recibido:', !!data.qrCode);
        if (data.qrCode) {
            console.log('Mostrando QR...');
            showQRCode(data.qrCode);
        } else {
            console.log('No se recibió QR del servidor');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast(error.message || 'Error al generar la imagen', 'error');
    } finally {
        loadingOverlay.style.display = 'none';
    }
}

function downloadImage() {
    const nombre = window.nombreUsuario || 'Usuario';
    const fecha = new Date();
    const dia = String(fecha.getDate()).padStart(2, '0');
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const año = fecha.getFullYear();
    const hora = String(fecha.getHours()).padStart(2, '0');
    const minuto = String(fecha.getMinutes()).padStart(2, '0');
    const segundo = String(fecha.getSeconds()).padStart(2, '0');
    const nombreLimpio = nombre.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]/g, '_');
    const nombreArchivo = `CartaFIFA_${nombreLimpio}_${dia}-${mes}-${año}_${hora}-${minuto}-${segundo}.png`;
    
    const link = document.createElement('a');
    link.href = resultImage.src;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Imagen descargada', 'success');
}

function resetForm() {
    imagePreview.src = '';
    promptInput.value = '';
    fileInput.value = ''; // Limpiar input file
    previewContainer.style.display = 'none';
    resultSection.style.display = 'none';
    generateBtn.disabled = true;
    
    // Limpiar QR
    const qrContainer = document.getElementById('qr-container');
    if (qrContainer) qrContainer.innerHTML = '';
    
    // Scroll al inicio
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Abrir la cámara
async function openCamera() {
    cameraModal.style.display = 'block';
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tu navegador no permite acceso a la cámara. Asegúrate de usar HTTPS.');
        cameraModal.style.display = 'none';
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        cameraVideo.srcObject = cameraStream;
    } catch (err) {
        console.error('Error de cámara:', err);
        alert('Error al abrir cámara: ' + (err.message || err.name));
        cameraModal.style.display = 'none';
    }
}

// Cerrar modal de cámara
function closeCamera() {
    cameraModal.style.display = 'none';
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

// Verificar salud de la API al cargar
async function checkApiHealth() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        
        if (!data.hasApiKey) {
            showToast('⚠️ Configura tu GOOGLE_API_KEY en el archivo .env', 'error');
        }
    } catch (error) {
        console.error('Error al verificar la API:', error);
    }
}

// Función para seleccionar color de piel
function selectSkin(tonoPiel) {
    // Remover selección anterior
    document.querySelectorAll('.skin-option').forEach(option => {
        option.style.border = '2px solid #e9ecef';
    });
    
    // Marcar opción seleccionada - buscar por el onclick que contiene el tono
    document.querySelectorAll('.skin-option').forEach(option => {
        if (option.getAttribute('onclick').includes(tonoPiel)) {
            option.style.border = '2px solid #434444ff';
        }
    });
    
    // Guardar selección
    window.tonoSeleccionado = tonoPiel;
    
    // Mostrar botón continuar
    document.getElementById('continue-photo-button').style.display = 'block';
}

// Función para abrir directamente la cámara después de seleccionar color de piel
function abrirCamara() {
    document.getElementById('skinSelectionContainer').style.display = 'none';
    document.getElementById('generatorContainer').style.display = 'block';
    // Abrir modal de cámara automáticamente
    setTimeout(() => {
        document.getElementById('cameraBtn').click();
    }, 100);
}

// Función para continuar a la sección de foto después de seleccionar color de piel
function continuarFoto() {
    document.getElementById('skinSelectionContainer').style.display = 'none';
    document.getElementById('generatorContainer').style.display = 'block';
}

// Función para seleccionar marco
function selectFrame(estiloMarco) {
    // Remover selección anterior
    document.querySelectorAll('.frame-option').forEach(option => {
        option.style.border = '2px solid #e9ecef';
    });
    
    // Marcar opción seleccionada
    document.querySelectorAll('.frame-option').forEach(option => {
        if (option.getAttribute('onclick') && option.getAttribute('onclick').includes(estiloMarco)) {
            option.style.border = '2px solid #434444ff';
        }
    });
    
    // Guardar selección
    window.marcoSeleccionado = estiloMarco;
}

// Función para mostrar QR de descarga
function showQRCode(qrCodeDataUrl) {
    const qrContainer = document.getElementById('qr-container');
    if (!qrContainer) return;
    
    qrContainer.innerHTML = '';
    
    // Crear título
    const title = document.createElement('h3');
    title.textContent = 'Escanea para descargar';
    title.style.color = '#ffffff';
    title.style.fontSize = '1.1rem';
    title.style.marginBottom = '10px';
    title.style.textShadow = '0 2px 4px rgba(0,0,0,0.5)';
    qrContainer.appendChild(title);
    
    // Mostrar QR generado por el servidor
    const qrImg = document.createElement('img');
    qrImg.src = qrCodeDataUrl;
    qrImg.style.width = '150px';
    qrImg.style.height = '150px';
    qrImg.style.border = '2px solid #ddd';
    qrImg.style.borderRadius = '10px';
    qrContainer.appendChild(qrImg);
}

// Ejecutar al cargar la página
checkApiHealth();
