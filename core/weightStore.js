/**
 * ==============================================================
 * weightStore.js - Stockage en mémoire des données de poids actuelles
 * Stockage mémoire du dernier poids détecté
 * ==============================================================
 */

/**
 * Store singleton pour stocker les données de poids actuelles
 * Utilisé par l'API HTTP locale pour exposer le dernier poids
 * @class WeightStore
 */
class WeightStore {

  /**
   * Crée une instance du store de poids
   * @constructor
   */
  constructor() {
    /**
     * Dernier poids enregistré (kg)
     * @type {number}
     */
    this.weight = 0;

    /**
     * Timestamp ISO du dernier poids
     * @type {string|null}
     */
    this.timestamp = null;

    /**
     * Code du terminal associé
     * @type {string|null}
     */
    this.terminalCode = null;

    /**
     * Dernière erreur réseau (string|null)
     * @type {string|null}
     */
    this.lastNetworkError = null;

    /**
     * Dernière erreur critique (string|null)
     * @type {string|null}
     */
    this.lastCriticalError = null;

    /**
     * Taille actuelle de la queue d'envoi
     * @type {number}
     */
    this.queueSize = 0;

    /**
     * État de connexion série
     * @type {boolean}
     */
    this.serialConnected = false;
  }

  /**
   * Met à jour le poids actuel
   * @param {number} weight - Nouveau poids en kg
   * @returns {void}
   */
  setWeight(weight) {
    this.weight = weight;
    this.timestamp = new Date().toISOString();
  }

  /**
   * Configure le code du terminal
   * @param {string} code - Code du terminal
   * @returns {void}
   */
  setTerminal(code) {
    this.terminalCode = code;
  }

  /**
   * Définit l'erreur réseau courante
   * @param {string|null} msg
   */
  setNetworkError(msg) {
    this.lastNetworkError = msg || null;
  }

  /**
   * Définit l'erreur critique courante
   * @param {string|null} msg
   */
  setCriticalError(msg) {
    this.lastCriticalError = msg || null;
  }

  /**
   * Met à jour la taille de la queue
   * @param {number} n
   */
  setQueueSize(n) {
    this.queueSize = Number(n) || 0;
  }

  /**
   * Définit l'état de connexion série
   * @param {boolean} v
   */
  setSerialConnected(v) {
    this.serialConnected = !!v;
  }

  /**
   * Récupère les données actuelles de poids
   * @returns {Object} Données de poids formatées
   * @returns {string|null} return.terminal_code - Code du terminal
   * @returns {number} return.weight - Poids en kg
   * @returns {string|null} return.timestamp - Timestamp ISO
   */
  getWeight() {
    return {
      terminal_code: this.terminalCode,
      weight: this.weight,
      timestamp: this.timestamp
    };
  }

  /**
   * Retourne un état étendu pour l'API /health
   * @returns {Object}
   */
  getStatus() {
    return {
      terminal_code: this.terminalCode,
      weight: this.weight,
      timestamp: this.timestamp,
      last_network_error: this.lastNetworkError,
      last_critical_error: this.lastCriticalError,
      queue_size: this.queueSize,
      serial_connected: this.serialConnected
    };
  }

}

/**
 * Instance singleton du WeightStore
 * @type {WeightStore}
 */
module.exports = new WeightStore();