import type { en } from './en.js';

/** French catalog: same keys and same `{parameters}` as `en.ts` (the type enforces the keys). */
export const fr: Record<keyof typeof en, string> = {
  'error.destination.exists': 'Un fichier existe déjà à {path} ; il n’a pas été touché.',
  'error.discover.not-found': 'Chemin introuvable : {path}',
  'error.fs.error': 'Erreur du système de fichiers ({code}) sur {path}',
  'error.fs.no-space': 'Plus d’espace disponible sur le volume pour {path}',
  'error.fs.permission-denied': 'Permission refusée pour {path}',
  'error.fs.read-only': 'Le système de fichiers est en lecture seule à {path}',
  'error.hardlink.cross-device':
    'Hardlink impossible : {source} et {destination} sont sur des systèmes de fichiers différents. Choisissez la copie ou le déplacement, ou une destination sur le même volume.',
  'error.hardlink.unsupported':
    'Ce système de fichiers ne gère pas les hardlinks ({destination}). Choisissez la copie ou le déplacement.',
  'error.main-not-done': 'Ignoré car le fichier vidéo lui-même n’a pas été transféré.',
  'error.move.verification-failed':
    'La copie déplacée de {source} ne correspond pas à l’original ; la source a été conservée.',
  'error.operation.unsupported': 'Opération pas encore prise en charge : {type}',
  'error.plan.episode-numbers-missing': 'Le numéro de saison ou d’épisode est introuvable.',
  'error.plan.outside-root': 'Le chemin cible sortirait du dossier de destination.',
  'error.plan.profile-feature-unsupported':
    'Ce profil utilise {feature}, pas encore pris en charge.',
  'error.plan.unsafe-segment': 'Le titre produirait un nom de dossier ou de fichier dangereux.',
  'error.profile.double-quoted-escape':
    'Profil invalide : les templates contenant \\{ ou \\} doivent utiliser des guillemets simples. ({detail})',
  'error.profile.invalid': 'Profil invalide à « {path} » : {detail}',
  'error.profile.invalid-path': 'Template invalide dans {field} : « {template} »',
  'error.profile.unknown': 'Profil inconnu « {id} ».',
  'error.profile.unknown-variable': 'Variable inconnue {variable} dans {field}.',
  'error.profile.yaml-syntax': 'Le profil n’est pas du YAML valide : {detail}',
  'error.provider.foreign-id':
    'Un identifiant du fournisseur « {received} » ne peut pas servir avec « {expected} ».',
  'error.source.missing': 'Fichier source introuvable : {path}',
  'error.template.empty-segment':
    'Le template de nom a produit un nom de dossier ou de fichier vide : {template}',
  'error.template.invalid-escape':
    'Échappement invalide dans le template « {template} » à la position {position}.',
  'error.template.invalid-variable':
    'Variable invalide « {variable} » dans le template « {template} ».',
  'error.template.missing-variable':
    'Impossible de construire le nom : aucune valeur pour {variable}.',
  'error.template.pad-on-text':
    'Le remplissage par des zéros ne s’applique pas à la variable texte {variable}.',
  'error.template.unexpected-brace':
    '« } » inattendu dans le template « {template} » à la position {position}.',
  'error.tmdb.http-error': 'TMDB a répondu avec le code HTTP {status}.',
  'error.tmdb.invalid-key':
    'TMDB a refusé la clé d’API. Vérifiez TMDB_API_KEY ou le fichier de configuration.',
  'error.tmdb.invalid-response': 'TMDB a envoyé une réponse que Kinoshelf ne comprend pas.',
  'error.tmdb.network':
    'TMDB est injoignable. Vérifiez le réseau et réessayez ; ce qui a déjà été récupéré est en cache.',
  'error.tmdb.not-found': 'TMDB ne connaît pas cette ressource.',
  'error.tmdb.rate-limited':
    'TMDB limite les requêtes. Réessayez dans un instant ; ce qui a déjà été récupéré est en cache.',
  'error.undo.destination-missing': 'Déjà supprimé : {path}',
  'error.undo.source-exists': 'Impossible de remettre le fichier : {path} existe maintenant.',

  'error.config.destination-required':
    'Indiquez une destination avec --dest (ou --dest-movies et --dest-series).',
  'error.config.invalid': 'Fichier de configuration invalide {path} : {detail}',
  'error.config.invalid-value': 'Valeur invalide « {value} » pour {option}.',
  'error.config.tmdb-key-missing':
    'Aucune clé d’API TMDB. Définissez la variable d’environnement TMDB_API_KEY ou « tmdbApiKey » dans {path}.',
  'error.unknown': 'Erreur inattendue ({code}).',

  'conflict.destination-exists': 'la destination existe déjà',
  'conflict.duplicate-destination': 'un autre fichier de ce lot a la même destination',
  'conflict.hardlink-cross-device': 'hardlink impossible : systèmes de fichiers différents',
  'conflict.unresolvable-name': 'le nom cible ne peut pas être construit',
  'unrecognized.no-title': 'aucun titre lisible dans le nom du fichier',
  'unrecognized.no-candidates': 'rien trouvé sur TMDB',

  'report.none': 'Aucun fichier vidéo trouvé.',
  'report.analyzed': 'Fichiers vidéo analysés : {count} · profil {profile} · mode {mode}',
  'report.destination': 'Destination : {destination}',
  'report.destinations': 'Destinations : films {movies} · séries {series}',
  'section.compliant': 'Déjà en place',
  'section.to-rename': 'À ranger',
  'section.conflict': 'Retenus',
  'section.ambiguous': 'Ambigus (validation requise)',
  'section.unrecognized': 'Non reconnus (validation requise)',
  'entry.score': 'score {score}',
  'entry.sidecars': '+ {count} fichier(s) associé(s)',
  'entry.candidate': '{title} ({year}) · score {score} · tmdb {id}',
  'entry.candidate-no-year': '{title} · score {score} · tmdb {id}',
  'summary.line':
    'Bilan : {compliant} en place, {toRename} à ranger, {conflict} retenus, {ambiguous} ambigus, {unrecognized} non reconnus.',
  'notice.scan': 'Analyse en lecture seule. Utilisez « process --apply » pour ranger ces fichiers.',
  'notice.dry-run': 'Simulation : rien n’a été écrit. Ajoutez --apply pour exécuter.',

  'apply.header': 'Exécution du lot {batch}',
  'result.skipped': 'ignoré : {reason}',
  'result.failed': 'échec : {reason}',
  'batch.summary': 'Lot {batch} : {done} faits, {skipped} ignorés, {failed} en échec.',
  'batch.undo-hint': 'Pour l’annuler : kinoshelf undo --apply',

  'undo.nothing': 'Rien à annuler.',
  'undo.header': 'Dernier lot : {batch}',
  'undo.skipped': 'ignoré : {reason}',
  'undo.failed': 'échec : {reason}',
  'undo.summary': '{undone} annulés, {skipped} ignorés, {failed} en échec.',
  'undo.dry-run': 'Simulation : rien n’a été modifié. Ajoutez --apply pour annuler.',

  'help.description': 'Identifie, renomme et enrichit des fichiers vidéo déjà sur disque.',
  'help.scan': 'Analyse une bibliothèque et indique ce qui changerait (n’écrit jamais).',
  'help.process': 'Identifie un fichier ou un dossier et le range (simulation sans --apply).',
  'help.undo': 'Annule le dernier lot exécuté (simulation sans --apply).',
  'help.arg.source': 'dossier ou fichier vidéo à analyser',
  'help.arg.path': 'fichier vidéo ou dossier à traiter',
  'help.opt.dest': 'dossier de destination des films et des séries',
  'help.opt.dest-movies': 'dossier de destination des films',
  'help.opt.dest-series': 'dossier de destination des séries',
  'help.opt.profile': 'profil de sortie : un identifiant fourni ou le chemin d’un fichier YAML',
  'help.opt.mode':
    'copy, hardlink ou move (par défaut : move si la destination est le dossier source, sinon copy)',
  'help.opt.threshold': 'score minimal (0-100) pour un traitement automatique',
  'help.opt.metadata-language': 'langue des titres récupérés sur TMDB, ex. fr ou en-US',
  'help.opt.lang': 'langue de cet outil : fr ou en',
  'help.opt.json': 'affiche du JSON exploitable par un script plutôt que du texte',
  'help.opt.apply': 'écrit réellement sur le disque',
  'help.opt.config-dir': 'dossier contenant config.yaml et la base de données',
};
