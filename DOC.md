# Documentation Technique - Balance Agent 2.0

## Vue d'ensemble

Le Balance Agent est une application Node.js qui connecte une balance industrielle à un système de surveillance centralisé. L'application lit les poids via un port série, les traite et les envoie à un serveur API tout en fournissant une interface web locale.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Balance       │────│   Serial Reader │────│ State Machine   │
│   Industrielle  │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Sync Service  │────│   API Server    │
                       │                 │    │   Central       │
                       └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   HTTP Server   │────│   Interface Web │
                       │   Local         │    │                 │
                       └─────────────────┘    └─────────────────┘
```

## Composants Principaux

### 1. Serial Reader (`serial/reader.js`)

**Responsabilités :**
- Connexion au port série de la balance
- Lecture des trames SICS (protocole balance)
- Parsing des poids stables uniquement
- Reconnexion automatique en cas de déconnexion

**Algorithme de reconnexion :**
- Retry exponentiel : 1s → 2s → 4s → ... → max 30s
- 10 premières tentatives en mode exponentiel
- Après la 10e tentative : retries continus toutes les 1 minute (sans arrêt de l'agent)
- Reconnexion automatique dès que le port redevient disponible
 - Fallback : si le port configuré ne répond pas après N tentatives (configurable),
   l'agent effectue un scan des ports disponibles et tentera d'identifier la balance automatiquement.
 - Priorisation de ports probables (COM3..COM10) pendant les scans pour accélérer la détection.

**Format des trames SICS :**
```
I4 A "C150168653"    # Identification terminal
S S +0123.45 kg      # Poids stable
S D +0123.45 kg      # Poids instable (ignoré)
```

### 2. State Machine (`core/stateMachine.js`)

**Responsabilités :**
- Filtrage des poids pour éviter les doublons
- Validation des poids (plage acceptable)
- Logique métier de déduplication

**Règles de filtrage :**
- Ignore les poids identiques consécutifs
- Ignore les poids en dehors de la plage [0, 10000] kg
- Tampon circulaire pour détecter les répétitions

### 3. Sync Service (`core/syncService.js`)

**Responsabilités :**
- Envoi des poids au serveur central
- Gestion des heartbeats (ping toutes les 5 secondes uniquement quand la balance est connectée)
- File d'attente (queue) en cas d'indisponibilité réseau
- Suivi de l'état de connexion série
 - Heartbeat enrichi : envoie immédiat d'un heartbeat lorsque la balance se déconnecte ou se reconnecte
   (payload inclut `heartbeat_event: 'serial_disconnected'` ou `'serial_connected'`).
 - Le heartbeat inclut aussi, si disponible, `last_critical_error` (erreurs série critiques)
   et `last_network_error` (détails de la dernière erreur réseau rencontrée).

**Payload API :**
```json
{
  "terminal_code": "C150168653",
  "weight_kg": 123.45,
  "reading_datetime": "2026-03-14T10:30:00.000Z",
  "source_device": "hostname"
}
```

**Payload Heartbeat :**
```json
{
  "terminal_code": "C150168653",
  "hostname": "server-name",
  "serial_connected": true
}
```
Exemple enrichi (quand une erreur réseau/critique existe) :
```json
{
  "terminal_code": "C150168653",
  "hostname": "server-name",
  "serial_connected": false,
  "heartbeat_event": "serial_disconnected",
  "last_critical_error": "Erreur port série : ...",
  "last_network_error": "No response from http://...: timeout"
}
```

### 4. HTTP Server Local (`server/httpServer.js`)

**Responsabilités :**
- API REST pour l'interface web locale
- Authentification par token
- Exposition des données de poids actuelles

**Endpoints :**
- `GET /weight` - Récupère le poids actuel
- `OPTIONS /weight` - CORS preflight

### 5. Logger (`core/logger.js`)

**Responsabilités :**
- Logging robuste sans crash
- Rotation automatique des fichiers
- Nettoyage des anciens logs
- Filtrage par niveau

**Configuration :**
- Rotation : 10 MB par fichier, max 5 fichiers/jour
- Rétention : 7 jours maximum
- Niveaux : INFO (console uniquement), WARN/ERROR (console + fichier)

### 6. Weight Store (`core/weightStore.js`)

**Responsabilités :**
- Stockage en mémoire des données actuelles
- Interface pour le serveur HTTP local
- Synchronisation thread-safe
 - Expose aussi l'état étendu pour `/health` : `last_network_error`, `last_critical_error`,
   `queue_size`, `serial_connected`.

### 7. Queue Manager (`core/queueManager.js`)

**Responsabilités :**
- File d'attente persistante sur disque
- Envoi différé en cas de panne réseau
- Récupération automatique au redémarrage

## Flux de Données

### Lecture Série → Traitement → Envoi

1. **Polling série** (toutes les 4 secondes) :
   ```
   Port Série → "SI\r\n" → Balance → "S S +0123.45 kg\r\n"
   ```

2. **Parsing et validation** :
   ```
   "S S +0123.45 kg" → Extraction numérique → Validation plage
   ```

3. **Filtrage métier** :
   ```
   Poids → State Machine → Déduplication → Acceptation/Rejet
   ```

4. **Envoi API** :
   ```
   Poids accepté → Payload JSON → POST /api/scale/log
   ```

5. **Heartbeat conditionnel** :
   ```
  Balance connectée + terminal identifié → toutes les 5s → POST /api/scale/heartbeat
  Balance indisponible → heartbeat suspendu automatiquement
   ```

## Gestion des Erreurs

### Reconnexion Série
- **Détection** : Événements `error` et `close` du port série
- **Stratégie** : 10 retries exponentiels puis retries continus toutes les 1 minute
- **Notification** : Heartbeat suspendu tant que la balance est indisponible

### Indisponibilité Réseau
- **File d'attente** : Stockage local des poids non envoyés
- **Retry automatique** : Tentatives continues en arrière-plan
- **Récupération** : Flush de la queue lors du rétablissement

### Erreurs Applicatives
- **Logger robuste** : Jamais de crash à cause du logging
- **Gestion d'exceptions** : Handlers pour uncaught exceptions
- **Arrêt propre** : Cleanup des ressources (timers, connexions)

## Configuration

### Variables d'Environnement
```javascript
// config.js
{
  SERIAL: {
    path: 'COM11',        // Port série
    baudRate: 9600,       // Vitesse transmission
    dataBits: 8,          // Bits de données
    stopBits: 1,          // Bits d'arrêt
    parity: 'none'        // Parité
  },
  API: {
    url: 'https://api.example.com/scale/log',
    heartbeatUrl: 'https://api.example.com/scale/heartbeat',
    token: 'bearer-token-here'
  },
  SYSTEM: {
    pollIntervalMs: 4000,    // Intervalle polling série
    retryIntervalMs: 5000,   // Intervalle retry réseau
    zeroHeartbeatMs: 60000   // Heartbeat spécial poids=0
  },
  LOCAL_SERVER: {
    port: 1789,             // Port serveur local
    token: 'local-api-token' // Token API locale
  }
}
```

## Métriques et Monitoring

### Logs Applicatifs
- **Niveaux** : INFO, WARN, ERROR
- **Rotation** : Automatique par taille et âge
- **Rétention** : 7 jours glissants

### Métriques Fonctionnelles
- **Connexion série** : État en temps réel via heartbeat
- **Taux d'envoi** : Succès/échec des appels API
- **File d'attente** : Nombre d'éléments en attente
- **Performances** : Latence des opérations

## Sécurité

### Authentification API
- **Bearer Token** : Authentification JWT pour l'API centrale
- **Token local** : Protection de l'API HTTP locale

### Validation des Données
- **Plage de poids** : Validation [0, 10000] kg
- **Format SICS** : Parsing strict des trames série
- **Sanitisation** : Échappement des caractères spéciaux

## Déploiement

### Prérequis Système
- **Node.js** : Version 16+ LTS
- **Port série** : Accès au périphérique (permissions)
- **Réseau** : Connexion à l'API centrale

### Processus de Démarrage
1. **Validation config** : Vérification des paramètres
2. **Création répertoires** : logs, storage
3. **Connexion série** : Tentative d'ouverture du port
4. **Démarrage services** : HTTP local, sync service
5. **Heartbeat** : Signal de vie continu

### Arrêt Propre
- **Signal handling** : SIGINT, SIGTERM
- **Cleanup** : Fermeture connexions, sauvegarde queue
- **Logging** : Trace de l'arrêt

## Dépannage

### Problèmes Courants

#### Port Série Non Disponible
```
Cause: Câble débranché, permissions insuffisantes
Solution: Vérifier ls /dev/tty*, chmod permissions
Logs: "Port série ouvert sur COM11"
```

#### API Centrale Indisponible
```
Cause: Réseau down, serveur maintenance
Solution: Vérifier connectivité, attendre récupération
Logs: Items en queue: X
```

#### Poids Non Reçus
```
Cause: Balance en mode instable, protocole incorrect
Solution: Vérifier configuration balance, logs trames
Logs: "Trame reçue: S S +0123.45 kg"
```

### Commandes de Diagnostic
```bash
# Vérifier port série
ls /dev/tty*

# Tester API locale
curl -H "Authorization: Bearer local-token" http://localhost:1789/weight

# Vérifier logs
tail -f logs/$(date +%Y-%m-%d).log

# Vérifier processus
ps aux | grep balance-agent
```

## Évolutions Futures

### Améliorations Fonctionnelles
- **Multi-balances** : Support de plusieurs ports série
- **Calibration** : Ajustement automatique des poids
- **Alertes** : Notifications en temps réel
- **Historique** : Base de données locale

### Améliorations Techniques
- **Clustering** : Haute disponibilité
- **Monitoring avancé** : Métriques Prometheus
- **Configuration hot-reload** : Rechargement sans restart
- **API REST complète** : Interface de gestion

---

*Documentation générée le 14 mars 2026*