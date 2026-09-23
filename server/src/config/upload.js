const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const BLOCKED_MIMES = ['application/json', 'application/x-javascript', 'text/javascript'];

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const fileFilter = (req, file, cb) => {
  if (BLOCKED_MIMES.includes(file.mimetype)) {
    return cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
  cb(null, true);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${name}-${suffix}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

const uploadProfile = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for profile pictures'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

const uploadGroup = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for group images'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

const uploadFiles = upload;

const getFileTypeCategory = (mimetype) => {
  const typeMap = [
    [/^image\//, 'image'],
    [/^video\//, 'video'],
    [/^audio\//, 'audio'],
    [/pdf/, 'pdf'],
    [/word|document/, 'document'],
    [/excel|sheet/, 'spreadsheet'],
    [/powerpoint|presentation/, 'presentation'],
    [/zip|rar|7z/, 'archive']
  ];
  
  const match = typeMap.find(([pattern]) => pattern.test(mimetype));
  return match ? match[1] : 'file';
};

module.exports = {
  upload,
  uploadProfile,
  uploadGroup,
  uploadFiles,
  getFileTypeCategory
};