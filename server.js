import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import QRCode from 'qrcode';
import os from 'os';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de multer para manejar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG y WEBP'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

// Inicializar Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Obtener la IP local de la máquina para que el QR funcione desde celulares en la misma red
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Función para limpiar archivos antiguos (mantener solo 30)
async function cleanOldFiles() {
  try {
    const downloadDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadDir)) return;
    
    const files = fs.readdirSync(downloadDir)
      .filter(file => file.startsWith('figura_') && file.endsWith('.png'))
      .map(file => ({
        name: file,
        path: path.join(downloadDir, file),
        time: fs.statSync(path.join(downloadDir, file)).mtime
      }))
      .sort((a, b) => b.time - a.time);
    
    if (files.length > 30) {
      const filesToDelete = files.slice(30);
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        console.log('Archivo eliminado:', file.name);
      });
    }
  } catch (error) {
    console.error('Error limpiando archivos:', error);
  }
}

// Función para procesar imagen: centrar, recortar y agregar marca de agua
async function processImage(base64Image) {
  try {
    const imageBuffer = Buffer.from(base64Image, 'base64');

    // Dimensiones finales: 2400x3600 (imagen 3300 + franja blanca 300)
    const finalWidth = 2400;
    const finalHeight = 3600;
    const bandHeight = 300;

    // Logo azul de Ingram, redimensionado para caber en la franja
    const logoPath = path.join(__dirname, 'public', 'Ingram.png');
    const logoBuffer = await sharp(logoPath)
      .resize({ height: 180, width: 1600, fit: 'inside' })
      .png()
      .toBuffer();
    const logoMeta = await sharp(logoBuffer).metadata();

    // Imagen principal + franja blanca inferior
    const baseImage = await sharp(imageBuffer)
      .resize(finalWidth, finalHeight - bandHeight, {
        fit: 'cover',
        position: 'center'
      })
      .extend({
        bottom: bandHeight,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .png()
      .toBuffer();

    // Logo centrado dentro de la franja
    const processedImage = await sharp(baseImage)
      .composite([{
        input: logoBuffer,
        top: Math.round((finalHeight - bandHeight) + (bandHeight - logoMeta.height) / 2),
        left: Math.round((finalWidth - logoMeta.width) / 2)
      }])
      .png()
      .toBuffer();

    return processedImage.toString('base64');
  } catch (error) {
    console.error('Error procesando imagen:', error);
    throw error;
  }
}

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint para generar imagen
app.post('/api/generate', upload.single('image'), async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'El prompt es requerido' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'La imagen es requerida' });
    }

    // Leer la imagen del usuario
    const imagePath = req.file.path;
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');

    // Configurar el modelo
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-image"
    });

    // Preparar el contenido para la API
    const parts = [
      { text: prompt },
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: base64Image
        }
      }
    ];

    // Adjuntar la camiseta seleccionada como segunda imagen de referencia
    // para que el modelo reproduzca exactamente ese diseño
    const { shirtFile } = req.body;
    if (shirtFile) {
      const shirtPath = path.join(__dirname, 'public', 'Camisas', path.basename(shirtFile));
      if (fs.existsSync(shirtPath)) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: fs.readFileSync(shirtPath).toString('base64')
          }
        });
        console.log('Camiseta de referencia adjuntada:', path.basename(shirtFile));
      } else {
        console.warn('No se encontró la camiseta de referencia:', shirtFile);
      }
    }

    console.log('Generando carta de jugador de fútbol con Gemini 2.5...');
    
    // Generar la imagen
    const result = await model.generateContent(parts);
    const response = await result.response;

    // Buscar la imagen generada en la respuesta
    let generatedImageBase64 = null;
    
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        generatedImageBase64 = part.inlineData.data;
        break;
      }
    }

    // Limpiar el archivo temporal
    fs.unlinkSync(imagePath);

    if (generatedImageBase64) {
      // Procesar imagen: centrar, recortar y agregar marca de agua
      const processedImageBase64 = await processImage(generatedImageBase64);
      
      // Guardar imagen en carpeta downloads
      const filename = `figura_${Date.now()}.png`;
      const downloadPath = path.join(__dirname, 'downloads', filename);
      const downloadDir = path.join(__dirname, 'downloads');
      
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
      }
      
      fs.writeFileSync(downloadPath, Buffer.from(processedImageBase64, 'base64'));
      
      // Limpiar archivos antiguos
      await cleanOldFiles();
      
      // Generar URL de descarga con la IP local para que el QR funcione desde otros dispositivos
      const host = req.get('host') || '';
      const baseHost = host.includes('localhost') || host.includes('127.0.0.1')
        ? `${getLocalIP()}:${PORT}`
        : host;
      const downloadUrl = `${req.protocol}://${baseHost}/downloads/${filename}`;
      console.log('URL de descarga generada:', downloadUrl);
      
      // Generar QR code
      const qrCode = await QRCode.toDataURL(downloadUrl);
      console.log('QR generado exitosamente, longitud:', qrCode.length);
      
      const response = {
        success: true,
        image: `data:image/png;base64,${processedImageBase64}`,
        downloadUrl: downloadUrl,
        qrCode: qrCode,
        message: 'Imagen generada y procesada exitosamente'
      };
      
      console.log('Respuesta enviada con QR:', !!response.qrCode);
      res.json(response);
    } else {
      res.status(500).json({
        error: 'No se pudo generar la imagen',
        details: 'La API no retornó una imagen'
      });
    }

  } catch (error) {
    console.error('Error al generar imagen:', error);
    
    // Limpiar archivo temporal en caso de error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: 'Error al generar la imagen',
      details: error.message
    });
  }
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Generador de Cartas FIFA API está funcionando',
    hasApiKey: !!process.env.GOOGLE_API_KEY
  });
});

// Endpoint para servir archivos de descarga
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'downloads', filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Archivo no encontrado' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Acceso desde la red local: http://${getLocalIP()}:${PORT}`);
  console.log(`⚽ Generador de Cartas de Fútbol FIFA está listo`);
  
  if (!process.env.GOOGLE_API_KEY) {
    console.warn('⚠️  ADVERTENCIA: No se encontró GOOGLE_API_KEY en el archivo .env');
  }
});
