# Balance Agent

*Connectez vos balances industrielles à votre système numérique*

## Qu'est-ce que c'est ?

Le **Balance Agent** est une application qui lit automatiquement les poids de vos balances industrielles et les envoie à votre système de gestion centralisé.

## Installation rapide

### Prérequis
- Node.js 16+ installé
- Accès au port série de votre balance
- Connexion réseau à votre serveur central

### Étapes
1. **Téléchargez** l'application
2. **Configurez** le port série dans `config.js`
3. **Lancez** avec `npm start`

```bash
cd balance-agent-2.0
npm install
npm start
```

## Comment ça marche ?

1. **Connexion** : L'agent se connecte automatiquement à votre balance via le port série
2. **Lecture** : Il lit les poids en temps réel (protocole SICS)
3. **Envoi** : Les poids sont automatiquement envoyés à votre serveur central
4. **Interface** : Une API locale permet à vos applications de consulter le poids actuel

## Fonctionnalités

✅ **Connexion automatique** à la balance
✅ **Reconnexion intelligente** en cas de déconnexion
✅ **Envoi sécurisé** des données au serveur central
✅ **API locale** pour vos applications
✅ **Logs détaillés** pour le dépannage
✅ **Fonctionnement offline** avec récupération automatique

## Configuration

Modifiez le fichier `config.js` selon vos besoins :

```javascript
SERIAL: {
  path: 'COM11',  // Votre port série
  baudRate: 9600  // Vitesse de connexion
},
API: {
  url: 'https://votre-serveur.com/api/scale/log',
  token: 'votre-token-api'
}
```

## Support

### Problèmes courants

**La balance n'est pas détectée**
- Vérifiez le câble série
- Confirmez le numéro de port (COM1, COM2, etc.)
- Vérifiez les permissions d'accès au port

**Les données n'arrivent pas au serveur**
- Vérifiez votre connexion réseau
- Confirmez l'URL et le token API
- Consultez les logs pour les erreurs

**L'application ne démarre pas**
- Vérifiez que Node.js est installé
- Lancez `npm install` pour installer les dépendances
- Vérifiez les logs d'erreur

### Logs et dépannage

Les logs sont dans le dossier `logs/` :
- Consultez `logs/YYYY-MM-DD.log` pour les événements du jour
- Les erreurs sont marquées `[ERROR]`
- Les avertissements sont marqués `[WARN]`

## Architecture technique

Pour les détails techniques complets, consultez [DOC.md](DOC.md) :
- Architecture détaillée
- Configuration avancée
- API endpoints
- Gestion des erreurs
- Métriques et monitoring

## Licence

Propriétaire - Glencore

---

*Développé par Yves KAYEMBE pour le projet LISO*

## Étape 1 — Lecture du poids

Le module `reader.js` :

* ouvre le port série
* interroge la balance toutes les **4 secondes**
* lit les trames SICS
* extrait les **poids stables uniquement**

Exemple trame :

```
S S    142.5 kg
```

---

## Étape 2 — Traitement métier

Le poids est transmis au module :

```
StateMachine
```

La StateMachine décide :

* si le poids doit être envoyé
* si le poids doit être ignoré

Cas gérés :

| Situation          | Action               |
| ------------------ | -------------------- |
| poids ≠ 0          | envoyé               |
| transition vers 0  | envoyé               |
| balance stable à 0 | heartbeat périodique |

---

## Étape 3 — Envoi au serveur central

Le module :

```
syncService.js
```

envoie les données vers :

```
POST /api/scale/log
```

Payload :

```json
{
  "terminal_code": "C150168653",
  "weight_kg": 142,
  "reading_datetime": "2026-03-12T08:10:21Z",
  "source_device": "WEIGH-PC-01"
}
```

Si le serveur est indisponible :

les données sont stockées dans :

```
storage/queue.json
```

et seront **ré-envoyées automatiquement**.

---

# 4. API locale du Balance Agent

Le Balance Agent expose une **API HTTP locale sécurisée**.

Adresse :

```
http://localhost:1789
```

Cette API permet à l’application web de lire **instantanément le poids**.

---

# Endpoint : health

Vérifie que l’agent fonctionne.

```
GET /health
```

Réponse :

```json
{
  "status": "ok",
  "service": "balance-agent",
  "uptime": 1542
}
```

---

# Endpoint : terminal

Retourne les informations du terminal connecté.

```
GET /terminal
```

Header requis :

```
Authorization: Bearer balance-local-secure-token
```

Réponse :

```json
{
  "terminal_code": "C150168653",
  "timestamp": "2026-03-12T08:21:11Z"
}
```

---

# Endpoint : weight

Retourne le dernier poids détecté.

```
GET /weight
```

Header requis :

```
Authorization: Bearer balance-local-secure-token
```

Réponse :

```json
{
  "terminal_code": "C150168653",
  "weight": 142,
  "timestamp": "2026-03-12T08:22:10Z"
}
```

---

# 5. Sécurité

Le serveur local implémente plusieurs protections :

## 1. Accès localhost uniquement

Le serveur écoute uniquement :

```
127.0.0.1
```

Donc aucun accès réseau externe.

---

## 2. Authentification par token

Les endpoints sensibles nécessitent :

```
Authorization: Bearer <token>
```

Token configuré dans :

```
config.js
```

---

## 3. CORS contrôlé

Seules les origines :

```
localhost
127.0.0.1
```

sont autorisées.

---

# 6. Structure du projet

```
balance-agent
│
├── app.js
│
├── config.js
│
├── core
│   ├── logger.js
│   ├── queueManager.js
│   ├── stateMachine.js
│   ├── syncService.js
│   └── weightStore.js
│
├── serial
│   └── reader.js
│
├── server
│   └── httpServer.js
│
└── storage
    └── queue.json
```

---

# 7. Description des modules

## app.js

Point d’entrée de l’application.

Responsabilités :

* démarrer le serveur local
* démarrer la lecture série
* connecter les modules

---

## reader.js

Responsable de :

* la communication série
* le parsing SICS
* l’extraction des poids stables

---

## stateMachine.js

Implémente la logique métier :

* détection des transitions
* gestion des poids zéro
* décision d’envoi

---

## syncService.js

Responsable de :

* l’envoi des poids
* la gestion offline
* la synchronisation de la queue

---

## queueManager.js

Gestion du stockage local lorsque :

```
le serveur central est indisponible
```

---

## weightStore.js

Stocke en mémoire :

* dernier poids
* timestamp
* terminal

Utilisé par l’API locale.

---

## httpServer.js

Expose l’API locale.

Fonctions :

* health check
* lecture poids
* sécurité locale

---

# 8. Workflow complet

```
Balance
   │
   ▼
reader.js
   │
   ▼
StateMachine
   │
   ├──► weightStore
   │         │
   │         ▼
   │     API locale
   │
   └──► syncService
             │
             ▼
       serveur LISO
```

---

# 9. Installation

## Installer Node.js

Version recommandée :

```
Node.js 18+
```

---

## Installer dépendances

```
npm install
```

---

## Lancer l’agent

```
node app.js
```

---

# 10. Test

Tester l’API locale :

```
http://localhost:1789/health
```

Puis :

```
http://localhost:1789/weight
```

---

# 11. Intégration dans l'application web

Exemple JavaScript :

```javascript
async function readWeight() {

  const res = await fetch("http://localhost:1789/weight", {
    headers: {
      "Authorization": "Bearer balance-local-secure-token"
    }
  });

  const data = await res.json();

  console.log("Poids :", data.weight);

}
```

---

# 12. Démarrage automatique Windows

Recommandé :

```
NSSM (Non-Sucking Service Manager)
```

Permet de transformer l’agent en :

```
Service Windows
```

Fonctions :

* démarrage automatique
* redémarrage en cas de crash
* supervision

---

# 13. Avantages de cette architecture

✔ lecture instantanée du poids
✔ compatible réseau sécurisé
✔ tolérance aux pannes réseau
✔ stockage offline
✔ API locale sécurisée
✔ architecture industrielle

---

# 14. Améliorations futures

Les prochaines versions pourront intégrer :

* WebSocket pour poids temps réel
* watchdog du port série
* reconnexion automatique balance
* mise à jour automatique de l’agent
* monitoring industriel

---

# 15. Conclusion

Le **Balance Agent** constitue le composant clé permettant de relier une balance industrielle au système d’information **LISO**.

Cette architecture garantit :

* fiabilité
* sécurité
* compatibilité industrielle
* extensibilité

dans un environnement de production cuivre ou métallurgique.

---

# 16. Déploiement en Service Windows (Production)

Dans un environnement industriel, le **Balance Agent** doit fonctionner comme un **service système permanent**.

Objectifs :

* démarrage automatique avec Windows
* fonctionnement sans session utilisateur
* redémarrage automatique en cas de crash
* supervision simplifiée

La solution recommandée est d’utiliser :

NSSM – Non-Sucking Service Manager

---

# 17. Installation de NSSM

Télécharger NSSM :

https://nssm.cc/download

Extraire l’archive dans :

C:\tools\nssm

Exemple :

```
C:\tools\nssm\win64\nssm.exe
```

---

# 18. Préparer l’installation du Balance Agent

Installer Node.js sur la machine industrielle.

Version recommandée :

```
Node.js LTS (18 ou supérieur)
```

Puis copier le projet sur la machine :

```
C:\balance-agent
```

Structure finale :

```
C:\balance-agent
│
├── app.js
├── config.js
├── core
├── serial
├── server
├── storage
└── package.json
```

Installer les dépendances :

```
npm install
```

---

# 19. Création du service Windows

Ouvrir un **terminal administrateur**.

Se déplacer dans le dossier NSSM :

```
cd C:\tools\nssm\win64
```

Créer le service :

```
nssm install BalanceAgent
```

Une fenêtre de configuration s’ouvre.

---

## Paramètres du service

Application Path :

```
C:\Program Files\nodejs\node.exe
```

Arguments :

```
C:\balance-agent\app.js
```

Startup directory :

```
C:\balance-agent
```

---

# 20. Configuration du redémarrage automatique

Dans l’onglet :

```
Shutdown
```

Configurer :

```
Restart delay : 5000 ms
```

Cela garantit que si l’agent s’arrête :

le service sera **redémarré automatiquement**.

---

# 21. Démarrage automatique au boot

Dans l’onglet :

```
Details
```

Startup type :

```
Automatic
```

Ainsi le service démarre **au démarrage de Windows**.

---

# 22. Lancer le service

Dans un terminal administrateur :

```
nssm start BalanceAgent
```

Vérifier le statut :

```
nssm status BalanceAgent
```

---

# 23. Vérification

Une fois le service lancé :

Tester l’API locale :

```
http://localhost:1789/health
```

Réponse attendue :

```
{
  "status": "ok",
  "service": "balance-agent"
}
```

---

# 24. Gestion du service

Arrêter le service :

```
nssm stop BalanceAgent
```

Redémarrer :

```
nssm restart BalanceAgent
```

Supprimer le service :

```
nssm remove BalanceAgent confirm
```

---

# 25. Vérification via Windows Services

Le service apparaît dans :

```
services.msc
```

Nom :

```
BalanceAgent
```

Statut :

```
Running
```

---

# 26. Surveillance du service

Le service peut être surveillé via :

* Windows Services
* Event Viewer
* logs du Balance Agent

Les logs sont écrits dans :

```
logs/YYYY-MM-DD.log
```

---

# 27. Garantie de disponibilité du serveur local

Le serveur local fait partie du processus principal du Balance Agent.

Si le processus s’arrête :

NSSM redémarrera automatiquement le service.

Cela garantit que l’API locale :

```
http://localhost:1789/weight
```

reste **toujours disponible**.

---

# 28. Workflow complet en production

```
Démarrage du PC industriel
        │
        ▼
Windows démarre
        │
        ▼
Service BalanceAgent lancé
        │
        ▼
Serveur local ouvert
        │
        ▼
Connexion balance série
        │
        ▼
Lecture poids
        │
        ├── API locale
        │
        └── Synchronisation serveur LISO
```

---

# 29. Robustesse industrielle

L’architecture actuelle garantit :

✔ démarrage automatique
✔ redémarrage automatique
✔ tolérance aux coupures réseau
✔ stockage offline
✔ serveur local permanent

Ce modèle est utilisé dans :

* systèmes MES
* pesage industriel
* automatisation usine
* intégration ERP

---

# 30. Recommandations de déploiement

Pour une installation industrielle stable :

1. Désactiver la mise en veille du PC
2. Fixer le port COM de la balance
3. Vérifier le firewall local
4. Tester la reconnexion balance
5. superviser les logs

---

# 31. Résultat final

Le Balance Agent devient un **service industriel permanent** :

```
BALANCE
   │
   ▼
Balance Agent (Service Windows)
   │
   ├── API locale
   │
   └── Synchronisation serveur
```

Le système fonctionne **24h/24 sans intervention humaine**.
