/**
 * ==============================================================
 * app/core/logger.js
 * Logger robuste (ne crash jamais)
 *
 * Auteur : Yves KAYEMBE
 * ==============================================================
 */

const fs = require('fs');
const path = require('path');

/**
 * Répertoire des fichiers de logs
 * @constant {string}
 */
const LOG_DIR = path.join(process.cwd(), 'logs');

// Créer le répertoire s'il n'existe pas
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Configuration de rotation des logs
 * @constant {number}
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Nombre maximum de fichiers de log par jour
 * @constant {number}
 */
const MAX_FILES = 5;

/**
 * Niveaux de log disponibles
 * @constant {Object.<string, number>}
 */
const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2 };

/**
 * Niveau minimum pour écrire dans le fichier (WARN et ERROR uniquement)
 * @constant {number}
 */
const FILE_LOG_LEVEL = LOG_LEVELS.WARN;

/**
 * Nettoie les anciens fichiers de logs (garde 7 jours maximum)
 * Supprime automatiquement les fichiers de log datant de plus de 7 jours
 * @function cleanupOldLogs
 * @returns {void}
 */
function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoffDate = sevenDaysAgo.toISOString().slice(0, 10);

    files.forEach(file => {
      if (file.endsWith('.log') || file.match(/\.log\.\d+$/)) {
        const fileDate = file.split('.')[0];
        if (fileDate < cutoffDate) {
          try {
            fs.unlinkSync(path.join(LOG_DIR, file));
          } catch (err) {
            console.error('Erreur suppression log ancien:', err.message);
          }
        }
      }
    });
  } catch (err) {
    console.error('Erreur nettoyage logs:', err.message);
  }
}

// Nettoyer au démarrage
cleanupOldLogs();

/**
 * Génère le chemin du fichier de log pour un index donné
 * @function logFile
 * @param {number} [index=0] - Index du fichier (0 pour le fichier principal, 1+ pour les fichiers rotés)
 * @returns {string} Chemin complet du fichier de log
 */
function logFile(index = 0) {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = index === 0 ? '' : `.${index}`;
  return path.join(LOG_DIR, `${date}.log${suffix}`);
}

/**
 * Récupère la taille d'un fichier en octets
 * @function getFileSize
 * @param {string} filePath - Chemin du fichier
 * @returns {number} Taille du fichier en octets, 0 si le fichier n'existe pas
 */
function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Effectue la rotation des fichiers de logs si nécessaire
 * Renomme les fichiers existants et crée un nouveau fichier principal
 * @function rotateLogs
 * @returns {void}
 */
function rotateLogs() {
  const baseFile = logFile(0);
  if (!fs.existsSync(baseFile) || getFileSize(baseFile) < MAX_FILE_SIZE) {
    return;
  }

  // Rotation des fichiers existants
  for (let i = MAX_FILES - 1; i >= 0; i--) {
    const currentFile = logFile(i);
    const nextFile = logFile(i + 1);
    if (fs.existsSync(currentFile)) {
      if (i === MAX_FILES - 1) {
        // Supprimer le fichier le plus ancien
        try {
          fs.unlinkSync(currentFile);
        } catch (err) {
          console.error('Erreur suppression log ancien:', err.message);
        }
      } else {
        try {
          fs.renameSync(currentFile, nextFile);
        } catch (err) {
          console.error('Erreur rotation log:', err.message);
        }
      }
    }
  }
}

function safeString(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Error) return value.stack || value.message;
  return String(value);
}

/**
 * Écrit un message dans le fichier de log avec rotation automatique
 * N'écrit que si le niveau de log est >= FILE_LOG_LEVEL
 * @function write
 * @param {string} level - Niveau du log ('INFO', 'WARN', 'ERROR')
 * @param {number} levelNum - Valeur numérique du niveau
 * @param {string} message - Message à logger
 * @param {boolean} [forceSync=false] - Force l'écriture synchrone (pour les logs critiques)
 * @returns {void}
 */
function write(level, levelNum, message, forceSync = false) {
  try {
    if (levelNum <= FILE_LOG_LEVEL) {
      rotateLogs();
      const line = `[${new Date().toISOString()}] [${level}] ${safeString(message)}\n`;
      fs.appendFileSync(logFile(), line, 'utf8');
    }
  } catch (err) {
    // 🔥 Le logger ne doit JAMAIS faire tomber l'app
    console.error('LOGGER FAILURE:', err.message);
  }
}

module.exports = {
  info(msg) {
    console.log(`ℹ️  ${safeString(msg)}`);
    write('INFO', LOG_LEVELS.INFO, msg);
  },
  warn(msg) {
    console.warn(`⚠️  ${safeString(msg)}`);
    write('WARN', LOG_LEVELS.WARN, msg);
  },
  error(msg) {
    console.error(`❌ ${safeString(msg)}`);
    write('ERROR', LOG_LEVELS.ERROR, msg);
  }
};
