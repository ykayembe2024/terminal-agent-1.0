/**
 * ==============================================================
 * queueManager.js - Gestionnaire de file d'attente persistante
 * app/core/queueManager.js
 *
 * Gestion locale des données en attente d'envoi
 * ==============================================================
 */

const fs = require('fs');
const path = require('path');
const {createRequire} = require("module");
const requireFile = createRequire(__filename);
const logger = requireFile('./logger');

/**
 * Gestionnaire de file d'attente persistante sur disque
 * Stocke les poids non envoyés en cas d'indisponibilité réseau
 * @class QueueManager
 */
class QueueManager {

  /**
   * Crée une instance du gestionnaire de queue
   * @constructor
   * @param {string} [filePath] - Chemin du fichier de stockage (défaut: storage/queue.json)
   */
  constructor(filePath = path.join(__dirname, '../storage/queue.json')) {
    /**
     * Chemin du fichier de stockage JSON
     * @type {string}
     */
    this.path = filePath;

    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.path)) {
      fs.writeFileSync(this.path, JSON.stringify([]));
    }
  }

  /**
   * Lit le contenu de la file d'attente depuis le disque
   * @returns {Array} Liste des éléments en attente
   */
  read() {
    try {
      const content = fs.readFileSync(this.path, 'utf8');
      return content ? JSON.parse(content) : [];
    } catch (err) {
      logger.error(`Erreur lecture queue (${this.path}) : ${err.message}`);
      return [];
    }
  }

  /**
   * Ajoute un élément à la file d'attente (optimisé pour gros volumes)
   * Utilise append au lieu de relire tout le fichier
   * @param {*} item - Élément à ajouter
   * @returns {void}
   */
  push(item) {
    try {
      // Pour le premier élément, créer le fichier avec un array
      const exists = fs.existsSync(this.path);
      if (!exists) {
        fs.writeFileSync(this.path, JSON.stringify([item], null, 2));
        return;
      }

      // Lire la taille actuelle pour déterminer si on peut append
      const stats = fs.statSync(this.path);
      if (stats.size === 0) {
        fs.writeFileSync(this.path, JSON.stringify([item], null, 2));
        return;
      }

      // Pour les ajouts suivants, lire et réécrire (limité à 1000 éléments max en mémoire)
      const items = this.read();
      if (items.length >= 1000) {
        // Rotation : garder seulement les 500 derniers éléments
        const rotatedItems = items.slice(-500);
        rotatedItems.push(item);
        fs.writeFileSync(this.path, JSON.stringify(rotatedItems, null, 2));
        logger.warn('Queue rotative : 500 éléments les plus anciens supprimés');
      } else {
        items.push(item);
        fs.writeFileSync(this.path, JSON.stringify(items, null, 2));
      }
    } catch (err) {
      logger.error(`Erreur écriture queue: ${err.message}`);
      // Fallback : essayer de créer un nouveau fichier
      try {
        fs.writeFileSync(this.path, JSON.stringify([item], null, 2));
      } catch (fallbackErr) {
        logger.error(`Erreur fallback queue: ${fallbackErr.message}`);
      }
    }
  }

  /**
   * Remplace tout le contenu de la queue
   * @param {Array} newItems - Nouveaux éléments à stocker
   * @returns {void}
   */
  replaceAll(newItems) {
    try {
      fs.writeFileSync(this.path, JSON.stringify(newItems || [], null, 2));
    } catch (err) {
      logger.error(`Erreur remplacement queue: ${err.message}`);
    }
  }

  /**
   * Retourne toute la queue
   * @returns {Array} Tous les éléments en attente
   */
  getAll() {
    return this.read();
  }

  /**
   * Retourne le nombre d'éléments dans la queue
   * @returns {number} Nombre d'éléments en attente
   */
  size() {
    try {
      return this.read().length;
    } catch (err) {
      logger.error(`Erreur calcul taille queue (${this.path}) : ${err.message}`);
      return 0;
    }
  }

  /**
   * Vérifie si la queue est vide
   * @returns {boolean} true si la queue est vide
   */
  isEmpty() {
    return this.size() === 0;
  }

}

module.exports = QueueManager;
