/**
 * ==============================================================
 * syncService.js - Service de synchronisation avec le serveur central
 * app/core/syncService.js
 *
 * Gestion locale pour synchroniser les poids entre la queue et la base de donnée
 * ==============================================================
 */

const {createRequire} = require("module");
const requireFile = createRequire(__filename);
const axios = require('axios');
const https = require('https');
const os = require('os');
const config = requireFile('../config');
const logger = requireFile('./logger');
const QueueManager = requireFile('./queueManager');

/**
 * Service de synchronisation des poids avec le serveur central
 * Gère l'envoi des données, les heartbeats et la file d'attente
 * @class SyncService
 */
class SyncService {

  /**
   * Crée une instance du service de synchronisation
   * @constructor
   */
  constructor() {
    /**
     * Code du terminal identifié
     * @type {string|null}
     */
    this.terminalCode = null;

    /**
     * Nom d'hôte de la machine
     * @type {string}
     */
    this.hostname = os.hostname();

    /**
     * Gestionnaire de file d'attente pour les poids non envoyés
     * @type {QueueManager}
     */
    this.queue = new QueueManager();

    /**
     * Flag pour éviter les flush simultanés
     * @type {boolean}
     */
    this.isFlushing = false;

    /**
     * État de connexion du port série
     * @type {boolean}
     */
    this.serialConnected = false;

    /**
     * Agent HTTPS pour ignorer la vérification SSL
     * @type {https.Agent}
     */
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });

    // 🔁 Heartbeat toutes les 5 secondes
    setInterval(() => {
      this.sendHeartbeat();
    }, 5000);
  }

  /**
   * Configure le code du terminal
   * @param {string} code - Code unique du terminal (ex: "C150168653")
   */
  setTerminal(code) {
    this.terminalCode = code;
    logger.info(`Terminal configuré : ${code}`);
  }

  /**
   * Met à jour l'état de connexion du port série
   * @param {boolean} connected - true si connecté, false si déconnecté
   */
  setSerialConnectionStatus(connected) {
    this.serialConnected = connected;
    logger.info(`État connexion série : ${connected ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`);
  }

  /**
   * Envoie un poids au serveur central
   * En cas d'échec, stocke dans la file d'attente
   * @async
   * @param {number} weight - Poids en kg à envoyer
   * @returns {Promise<void>}
   */
  /**
   * Envoie un poids au serveur central
   * En cas d'échec, stocke dans la file d'attente
   * @async
   * @param {number} weight - Poids en kg à envoyer
   * @returns {Promise<void>}
   */
  async send(weight) {

    if (!this.terminalCode) return;

    const payload = {
      terminal_code: this.terminalCode,
      weight_kg: Math.round(weight),
      reading_datetime: new Date().toISOString(),
      source_device: this.hostname
    };

    try {

      await axios.post(config.API.url, payload, {
        headers: {
          Authorization: `Bearer ${config.API.token}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: this.httpsAgent
      });

      this.flushQueue();

    } catch (err) {
      this.queue.push(payload);
      logger.warn(`Poids mis en queue (${this.queue.size()} éléments)`);
    }
  }

  /**
   * Envoie un heartbeat au serveur central
   * Signale l'état de santé de l'agent et la connexion série
   * @async
   * @returns {Promise<void>}
   */
  async sendHeartbeat() {

    if (!this.terminalCode) {
      logger.warn("Heartbeat ignoré : terminalCode non défini");
      return;
    }

    const payload = {
      terminal_code: this.terminalCode,
      hostname: this.hostname,
      serial_connected: this.serialConnected
    };

    try {

      const response = await axios.post(config.API.heartbeatUrl, payload, {
        headers: {
          Authorization: `Bearer ${config.API.token}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: this.httpsAgent,
        timeout: 5000
      });

      logger.info(`Heartbeat OK (${response.status})`);

    } catch (err) {

      if (err.response) {
        // Le serveur a répondu avec une erreur HTTP
        logger.error(`Heartbeat HTTP ${err.response.status}`);
        logger.error(`Réponse serveur: ${JSON.stringify(err.response.data)}`);
      }
      else if (err.request) {
        // La requête est partie mais aucune réponse
        logger.error("Heartbeat : aucune réponse du serveur");
      }
      else {
        // Erreur interne Axios
        logger.error(`Heartbeat erreur: ${err.message}`);
      }
    }
  }


  async flushQueue() {

    if (this.isFlushing) return;
    this.isFlushing = true;

    const items = this.queue.getAll();
    if (items.length === 0) {
      this.isFlushing = false;
      return;
    }

    logger.info(`Flush queue: ${items.length} éléments à envoyer`);
    const remaining = [];

    for (const payload of items) {
      try {
        await axios.post(config.API.url, payload, {
          headers: {
            Authorization: `Bearer ${config.API.token}`,
            'Content-Type': 'application/json'
          },
          httpsAgent: this.httpsAgent
        });
      } catch {
        remaining.push(payload);
        break; // Arrêt au premier échec
      }
    }

    this.queue.replaceAll(remaining);
    if (remaining.length < items.length) {
      logger.info(`Flush partiel: ${items.length - remaining.length} éléments envoyés`);
    }
    this.isFlushing = false;
  }
}

module.exports = SyncService;
