# Expérience Groq pour Atelier

Recherche et intégration préparées le **1er novembre 2026**, sur `experiment/groq-provider`. Cette branche n’est **pas déployée sur la page github.io**. Les tests Groq utilisent des réponses simulées ; aucun compte, aucune vraie clé et aucun appel Groq réel n’ont été utilisés. Le déchargement du modèle local a, lui, été vérifié réellement sur le PC.

## Ce que cela change

Groq peut effectuer la réécriture, les résumés, la recherche dans les documents transmis et la dictée à la place des modèles locaux. Le service reçoit les données choisies : ce mode implique un traitement distant. Le mode local reste une alternative.

Le flux conservé est : **navigateur → Supabase → service du PC → Groq → service du PC → Supabase → navigateur**. Le PC doit donc rester allumé et connecté, même en mode Groq. Aucun port entrant n’est nécessaire. Les modèles locaux ne sont pas nécessaires pour une opération traitée par Groq. Un fonctionnement PC éteint demanderait un relais serveur supplémentaire, qui ne fait pas partie de cet adaptateur.

Le choix Local/Groq dans l’application est enregistré comme préférence explicite dans Supabase. Le service du PC récupère cette préférence sur notification et la vérifie au moins toutes les dix secondes lorsqu’il est libre. Il ne change jamais de fournisseur automatiquement après une erreur.

Pour passer à Groq, il attend que son traitement en cours soit terminé et que son processus enfant ait été rejoint, puis demande à Ollama de décharger **uniquement le modèle `ATELIER_MODEL`**. Il vérifie ensuite son absence dans `/api/ps`. Whisper vit dans le processus enfant terminé : aucun modèle Whisper n’est chargé pour les demandes Groq. Si la clé manque, la mémoire est quand même libérée si possible, mais les demandes Groq restent bloquées avec une explication.

Revenir à Local conserve les modèles sur disque et permet leur chargement à la prochaine demande. Ni le choix Local ni une vérification de présence ne lancent une inférence. Le service Ollama et les autres modèles ne sont pas arrêtés. Les accès de déchargement suivent [la FAQ Ollama](https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately) : `/api/generate` avec `keep_alive: 0`, puis [vérification des modèles chargés](https://docs.ollama.com/api/ps).

Une demande conserve le fournisseur choisi lors de sa création. La base refuse un changement de mode tant que des demandes restent en attente ou en cours. Même après une annulation côté navigateur, le PC attend encore la fin effective de son processus avant de confirmer le déchargement. Si la préférence change pendant la confirmation, la révision est refusée et le PC relit la préférence avant tout nouveau travail.

## Modèles et gratuité vérifiés

Le choix proposé est `openai/gpt-oss-20b`, effort `low`, pour le texte, et `whisper-large-v3-turbo` pour la dictée française. GPT-OSS 20B est dans le catalogue de production ; sa qualité pour nos notes devra être évaluée avec des exemples réels. [Catalogue Groq](https://console.groq.com/docs/models), [fiche GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b).

Les plafonds documentés du **Free Plan** sont :

| Modèle | Requêtes/min | Requêtes/jour | Tokens/min | Tokens/jour | Audio/h | Audio/jour |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `openai/gpt-oss-20b` | 30 | 1 000 | 8 000 | 200 000 | — | — |
| `openai/gpt-oss-120b` | 30 | 1 000 | 8 000 | 200 000 | — | — |
| `qwen/qwen3.8-27b` | 30 | 1 000 | 8 000 | 200 000 | — | — |
| `whisper-large-v3-turbo` | 20 | 2 000 | — | — | 7 200 s | 28 800 s |
| `whisper-large-v3` | 20 | 2 000 | — | — | 7 200 s | 28 800 s |

28 800 secondes représentent 8 heures audio par jour. Le premier plafond atteint bloque ; les limites sont partagées par l’organisation. Les limites exactes du compte peuvent différer et restent visibles dans sa console. Un dépassement renvoie HTTP 429. [Limites officielles](https://console.groq.com/docs/rate-limits).

Un compte et une clé API Groq sont nécessaires, même pour l’offre gratuite. Le passage à Developer requiert un moyen de paiement et active une facturation à l’usage. Pour l’essai gratuit, conserver le Free Plan. [Démarrage et clé](https://console.groq.com/docs/quickstart), [facturation](https://console.groq.com/docs/billing-faqs).

La dictée accepte les fichiers WebM, MP4/M4A, OGG et WAV utilisés par Atelier. Le plafond Groq gratuit est 25 Mo ; l’adaptateur conserve la limite Atelier de 4 Mo. En offre payante, Whisper Turbo coûte 0,04 $/heure audio et Whisper V3 0,111 $/heure, avec 10 secondes facturées au minimum par demande. [Documentation audio](https://console.groq.com/docs/speech-to-text).

Ne pas reprendre les anciens tutoriels recommandant Llama 3.1 8B ou Llama 3.3 70B pour le Free Plan : ces modèles ont été retirés des offres Free/Developer le 16 août 2026. Qwen3.8-27B reste un modèle Preview. Modèles et plafonds peuvent évoluer ; l’application ne doit pas dépendre d’une gratuité ou d’une disponibilité permanente. [Historique des modèles](https://console.groq.com/docs/deprecations), [fiche Qwen](https://console.groq.com/docs/model/qwen/qwen3.8-27b).

## Confidentialité et clé

Groq annonce ne pas conserver par défaut les contenus d’inférence. Des exceptions existent pour la fiabilité et la détection d’abus, avec une conservation possible jusqu’à 30 jours. Tous les clients peuvent activer **Zero Data Retention** dans les [Data Controls](https://console.groq.com/settings/data-controls). Les métadonnées d’usage restent collectées et les données conservées sont hébergées aux États-Unis. ZDR ne rend pas le traitement local : Groq reçoit toujours le texte ou l’audio pour calculer la réponse. [Politique de données](https://console.groq.com/docs/your-data).

La clé doit être renseignée uniquement sous `ATELIER_GROQ_API_KEY` dans le fichier privé du service PC, avec des droits 600. Elle ne doit pas devenir une variable `VITE_*`, une donnée du navigateur, un champ de ticket ou une donnée synchronisée. Le service ne doit pas transmettre cette variable aux processus Codex. Aucun secret n’est présent dans les exemples ou tests de ce prototype.

## Activation après validation de la branche

Cette expérience requiert les fichiers de la branche expérimentale et sa future publication web. Le sélecteur ne figure pas encore sur la version actuellement publiée à l’adresse github.io. Les étapes suivantes servent à son activation lorsque la branche sera retenue.

1. Créer le compte sur [Groq Console](https://console.groq.com/), puis ouvrir directement [API Keys](https://console.groq.com/keys). Cliquer **Create API Key**, donner le nom `Atelier`, puis copier la clé affichée. Conserver le Free Plan pour les essais.
2. Ouvrir directement [Data Controls](https://console.groq.com/settings/data-controls), puis activer **Zero Data Retention** si souhaité. C’est un réglage du compte Groq, pas de Supabase.
3. Sur le PC, ouvrir un terminal et exécuter :

   ```bash
   python3 /home/mblaret/Documents/kanban/worker/configure_groq.py
   ```

   Coller la clé à l’invite invisible, puis appuyer sur **Entrée**. Ce script ne teste pas la clé et ne l’envoie nulle part ; il préserve les autres paramètres du fichier privé.
4. Appliquer la migration Supabase de la branche : ouvrir [008_assistant_providers.sql sur GitHub](https://github.com/MaximeESIR/kanban/blob/experiment/groq-provider/supabase/migrations/008_assistant_providers.sql), cliquer **Raw**, puis copier tout le texte. Dans le projet Supabase, ouvrir **SQL Editor → New query**, coller le texte, puis cliquer **Run**. Le résultat attendu est **Success. No rows returned**. Si la migration 007 n’a pas déjà été exécutée, appliquer d’abord [007_repository_paths.sql](https://github.com/MaximeESIR/kanban/blob/experiment/groq-provider/supabase/migrations/007_repository_paths.sql), avec les mêmes clics. Ne pas relancer les migrations déjà appliquées.
5. Une fois les fichiers de la branche en place et la publication web faite, recharger le programme du PC avec le script d’installation habituel :

   ```bash
   bash /home/mblaret/Documents/kanban/worker/connect_pc.sh
   ```

6. Dans Atelier, ouvrir **Assistant PC**, choisir **Groq**, puis attendre l’état prêt et la confirmation du déchargement. Tester d’abord une note courte et une dictée sans contenu sensible. Le retour à **Local** se fait au même endroit.

Sans migration 008, le nouveau service conserve uniquement l’ancien fonctionnement local. Une erreur réseau ou une préférence inconnue ne l’autorise jamais à choisir Groq. Après confirmation que le serveur connaît la migration, une disparition des RPC bloque le traitement au lieu de basculer vers un autre mode.

## Contrat de l’adaptateur Python

`worker/groq_provider.py` utilise uniquement la bibliothèque standard Python :

```python
from groq_provider import GroqProvider, GroqError, is_configured

engine = GroqProvider()  # Lit la clé dans l’environnement privé du service PC.
text = engine.chat(system_instruction, document)
matches_json = engine.chat(search_instruction, documents_json, json_output=True)
transcript = engine.transcribe(temporary_audio_path)
```

`GroqError` contient un message français affichable. Le service doit renvoyer ce message à l’application, sans sérialiser l’exception HTTP d’origine. `is_configured()` vérifie uniquement la configuration locale : il ne vérifie ni la validité du compte, ni les quotas, ni la disponibilité réseau.

Les deux destinations sont fixes, sous `https://api.groq.com/openai/v1/`. Les redirections sont refusées ; les proxys hérités de l’environnement ne sont pas utilisés. Les erreurs ne recopient ni les réponses HTTP brutes, ni la clé, ni les textes privés. Le module ne lance aucun outil et ne réessaie pas automatiquement une demande refusée par quota.

Le texte est limité à **5 500 octets UTF-8, instructions comprises**, avec **2 048 tokens maximum de réponse et raisonnement**. Cette marge volontairement conservatrice tient compte du plafond de 8 000 tokens/minute sans installer un tokenizer supplémentaire. Elle ne réserve aucun quota : d’autres appels du même compte peuvent encore provoquer une erreur 429. Les longues notes et grandes recherches sont refusées explicitement, jamais tronquées en silence. Une sélection d’extraits ou un découpage demanderait un travail supplémentaire.

Les réponses HTTP sont bornées à 512 000 octets et leur structure est validée. Une réponse texte interrompue par la limite de sortie est refusée. Le timeout réseau est de 90 secondes ; le service garde son propre délai global et ses règles d’annulation. La validation des identifiants de recherche et le contrôle avant application des résultats restent dans `process_job` et l’application.

## Mémoire

Les mesures locales de cette session indiquent environ **3,4 Go de RAM pour Qwen, avec 0 VRAM**, et **605 Mio au chargement de Whisper small CPU int8**, avant les variations d’inférence. Choisir Groq et décharger effectivement les moteurs locaux évite cette consommation de RAM. Cela ne libère pas 4 Go de VRAM dans la configuration actuelle. Les fichiers des modèles peuvent rester sur disque pour revenir au mode local.

Un essai réel avec une invite publique a chargé Qwen3.5:4b sur CPU, contexte 8 192, puis le helper de déchargement l’a retiré de `/api/ps` : **3 376 404 232 octets déclarés avant décharge, 0 octet de VRAM**, puis aucune entrée chargée. `/api/tags` confirmait ensuite que le modèle était toujours installé. Le retour local est vérifié par les tests de configuration et reste à la demande : choisir Local ne force pas une inférence pour précharger le modèle.

L’adaptateur HTTP seul ne décharge pas un Qwen déjà chargé par Ollama : ce travail est effectué par `assistant_settings.py`, appelé par le service. La confirmation de déchargement décrit la vérification effectuée lors du changement de mode ; un autre programme peut ultérieurement recharger le même modèle. Si Ollama est inaccessible et qu’un modèle local est configuré, le déchargement ne peut pas être confirmé : l’état reste bloqué avec une explication.

## Vérification et limites actuelles

19 tests simulés de l’adaptateur passent : destination HTTPS, authentification, clé absente, refus des redirections, quotas, timeout, erreurs sans secrets, limites d’entrée/sortie, réponse tronquée, JSON invalide, multipart français, formats audio et contrôle des tailles. Le transport est remplacé par un faux serveur dans chaque test, et les connexions socket sont interdites. Les tests de `test_assistant_settings.py` vérifient en plus le routage, les révisions concurrentes, l’annulation d’un enfant encore actif, le déchargement, les clés absentes, le retour local et la compatibilité sans migration 008.

Depuis la racine du dépôt, après intégration des fichiers dans `worker/` :

```bash
python3 -m unittest discover -s worker -p 'test_groq_provider.py' -v
python3 -m unittest discover -s worker -p 'test_assistant_settings.py' -v
```

Avant cette intégration, le même test se lance avec `-s artifacts/groq-experiment/worker`.

Aucun test réel de qualité Groq, de délai de dictée distante, de quota du compte ou de fonctionnement mobile avec une vraie clé n’a encore eu lieu. Les tests simulés ne remplacent pas cet essai réel. Le déchargement réel d’Ollama a été vérifié comme décrit ci-dessus ; le basculement complet depuis un téléphone vers Groq reste à valider avec le compte et la clé. Aucun redémarrage du service actif ni modification de sa configuration privée n’ont été réalisés pendant ce développement.
