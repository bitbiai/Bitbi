import { BITBI_LIVE_CREDIT_PACKS } from '../../js/shared/live-credit-packs.mjs';
import { BITBI_MEMBER_SUBSCRIPTION } from '../../js/shared/member-subscription.mjs';
import { getMemberExposedModels } from '../../js/shared/member-model-exposure.mjs';

// Reviewed public product guidance, not a crawl of source or private workspaces.
// Source-code provenance is maintained separately and never enters model context.
const article = (id, pages, path, en, de, keywords = []) => Object.freeze({
  id, pages, path, keywords, en: Object.freeze(en), de: Object.freeze(de),
});
const formatAmount = (cents, language) => new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const packCopy = language => BITBI_LIVE_CREDIT_PACKS.filter(pack => pack.active && pack.currency === 'eur')
  .map(pack => `${pack.credits} ${language === 'de' ? 'Credits für' : 'credits for'} ${formatAmount(pack.amountCents, language)}`).join('; ');
const modelCopy = language => ['image', 'video', 'music'].map(type => {
  const labels = { en: { image: 'Image', video: 'Video', music: 'Music' }, de: { image: 'Bild', video: 'Video', music: 'Musik' } };
  return `${labels[language][type]}: ${getMemberExposedModels().filter(model => model.mediaType === type && !model.runtimeApprovalRequired).map(model => model.label).join(', ')}.`;
}).join(' ');

export const knowledgeArticles = Object.freeze([
  article('getting-started', ['home', 'generate-lab', 'profile'], '/generate-lab/', {
    title: 'Start creating with BITBI', question: 'How do I start creating with BITBI?',
    text: 'BITBI offers image, video and music creation. Open Generate Lab, sign in, choose a media type and model, enter a prompt, review the settings and displayed credit estimate, then choose Generate. Canvas provides connected visual workflows. Saved results are managed in Assets Manager. Public browsing does not require an account; generation and saved assets do.',
  }, {
    title: 'Mit BITBI erstellen', question: 'Wie starte ich mit BITBI?',
    text: 'BITBI bietet Bild-, Video- und Musikgenerierung. Öffnen Sie Generate Lab, melden Sie sich an, wählen Sie Medientyp und Modell, geben Sie einen Prompt ein und prüfen Sie Einstellungen und angezeigte Credit-Schätzung. Wählen Sie dann Generieren. Canvas bietet verknüpfte visuelle Workflows. Gespeicherte Ergebnisse verwalten Sie im Assets Manager. Öffentliches Browsen erfordert kein Konto; Generierung und gespeicherte Assets schon.',
  }, ['start', 'begin', 'getting started', 'anfangen', 'einstieg']),
  article('image-model-choice', ['home', 'images', 'generate-lab'], '/generate-lab/', {
    title: 'Choose an image model', question: 'How do I choose an image model?',
    text: 'Choose Images in Generate Lab and compare the model help and controls. Check whether the model supports your required dimensions, output format, transparency or reference images. Available controls vary by model. Review the current credit estimate with your chosen settings before generating; a model name alone does not establish price or output quality. No model is guaranteed to be best for every prompt.',
  }, {
    title: 'Ein Bildmodell wählen', question: 'Wie wähle ich ein Bildmodell?',
    text: 'Wählen Sie Bilder im Generate Lab und vergleichen Sie die Modellhilfe und Einstellungen. Prüfen Sie, ob das Modell die benötigte Größe, das Ausgabeformat, Transparenz oder Referenzbilder unterstützt. Die verfügbaren Einstellungen unterscheiden sich je nach Modell. Prüfen Sie vor der Generierung die aktuelle Credit-Schätzung für Ihre Einstellungen; der Modellname allein bestimmt weder Preis noch Ausgabequalität. Kein Modell ist für jeden Prompt garantiert das beste.',
  }, ['image model', 'Bildmodell', 'transparency', 'transparent', 'dimensions', 'format', 'best model']),
  article('member-models', ['home', 'images', 'video', 'music', 'generate-lab'], '/generate-lab/', {
    title: 'Models listed for member creation', question: 'Where can I compare the available models?',
    text: `The member model catalog currently lists: ${modelCopy('en')} Open Models or the selected model's help for its controls. Listing is not a guarantee that every operation is currently enabled; disabled controls and the server's current response are authoritative. Canvas has its own supported operations; do not assume every listed model supports every Canvas input.`,
  }, {
    title: 'Modelle für Mitglieder', question: 'Wo kann ich die verfügbaren Modelle vergleichen?',
    text: `Der Modellkatalog für Mitglieder führt derzeit: ${modelCopy('de')} Öffnen Sie Models oder die Hilfe zum ausgewählten Modell für dessen Einstellungen. Ein Katalogeintrag garantiert nicht, dass jede Aktion gerade freigeschaltet ist; deaktivierte Einstellungen und die aktuelle Serverantwort sind maßgeblich. Canvas hat eigene unterstützte Aktionen; nicht jedes gelistete Modell unterstützt jeden Canvas-Input.`,
  }, ['available models', 'model list', 'Models', 'Modellliste', 'Modellkatalog', 'verfügbare Modelle']),
  article('image-references', ['images', 'generate-lab'], '/generate-lab/', {
    title: 'Use image references', question: 'How do I add reference images?',
    text: 'For a model that offers reference images, use the reference control to upload from your computer or select compatible saved images in Assets Manager. Selection order matters and is shown in the picker. The selected model defines the allowed count, size and formats; not every image model supports references or every edit operation. Reference inputs may change the credit estimate. Check the displayed validation before generating.',
  }, {
    title: 'Referenzbilder verwenden', question: 'Wie füge ich Referenzbilder hinzu?',
    text: 'Bei einem Modell mit Referenzbildern nutzen Sie die Referenz-Auswahl, um vom Computer hochzuladen oder passende gespeicherte Bilder im Assets Manager zu wählen. Die Reihenfolge ist relevant und wird in der Auswahl angezeigt. Das gewählte Modell bestimmt Anzahl, Größe und Formate; nicht jedes Bildmodell unterstützt Referenzen oder jede Bearbeitung. Referenzen können die Credit-Schätzung verändern. Prüfen Sie vor dem Generieren die angezeigte Validierung.',
  }, ['reference images', 'Referenzbilder', 'upload', 'hochladen', 'reference order']),
  article('video-references', ['video', 'generate-lab', 'canvas'], '/generate-lab/', {
    title: 'Video prompts and reference media', question: 'How do I use reference images for a video?',
    text: 'Choose Video and a model, then check its model help and input controls. Some models accept one image for image-to-video, others accept multiple saved references or separate first/last frames. These modes are not interchangeable. Use only reference types offered by the selected model, and review duration, aspect ratio, resolution and credit estimate. A requested resolution or size does not guarantee exact output dimensions. A disabled edit or extend action must not be treated as available.',
  }, {
    title: 'Video-Prompts und Referenzen', question: 'Wie nutze ich Referenzbilder für ein Video?',
    text: 'Wählen Sie Video und ein Modell und prüfen Sie dessen Modellhilfe und Eingabeeinstellungen. Manche Modelle nehmen ein Bild für Bild-zu-Video an, andere mehrere gespeicherte Referenzen oder getrennte Anfangs- und Endbilder. Diese Modi sind nicht austauschbar. Nutzen Sie nur die angebotenen Referenztypen und prüfen Sie Dauer, Seitenverhältnis, Auflösung und Credit-Schätzung. Angeforderte Auflösung oder Größe garantiert keine exakten Ausgabeabmessungen. Eine deaktivierte Bearbeitungs- oder Verlängerungsaktion ist nicht verfügbar.',
  }, ['video reference', 'image to video', 'Bild zu Video', 'Videoreferenz', 'first frame', 'last frame', 'Anfangsbild', 'Endbild']),
  article('music-workflow', ['music', 'generate-lab'], '/generate-lab/', {
    title: 'Create music', question: 'How do I create music or an instrumental track?',
    text: 'Choose Music in Generate Lab and select a model. Describe the desired style, mood, instruments and vocal direction. Depending on the model, use its lyrics, instrumental or composition controls. Instrumental mode and lyrics are alternatives; only the selected model’s visible controls are supported. Review the credit estimate and generate. Successful music results are saved as private assets in Assets Manager, where you can play and organize them.',
  }, {
    title: 'Musik erstellen', question: 'Wie erstelle ich Musik oder einen Instrumentaltrack?',
    text: 'Wählen Sie Musik im Generate Lab und ein Modell. Beschreiben Sie Stil, Stimmung, Instrumente und Gesang. Nutzen Sie je nach Modell dessen Songtext-, Instrumental- oder Kompositionseinstellungen. Instrumentalmodus und Songtext sind Alternativen; unterstützt werden nur die sichtbaren Einstellungen des gewählten Modells. Prüfen Sie die Credit-Schätzung und generieren Sie. Erfolgreiche Musikergebnisse werden als private Assets im Assets Manager gespeichert und können dort abgespielt und organisiert werden.',
  }, ['music', 'Musik', 'instrumental', 'lyrics', 'Songtext', 'track', 'song']),
  article('save-results', ['assets', 'generate-lab', 'images', 'video', 'music'], '/account/assets-manager.html', {
    title: 'Save and find generated results', question: 'Where do I find my generated results?',
    text: 'Check the result’s displayed state. An image marked Preview ready needs Save to Assets Manager before you leave the page. Accepted background jobs continue on the server and save successful results automatically; successful video and music results are saved privately. Open Assets Manager, refresh recent assets and show all folders if an item is missing. Check Generation jobs when processing is still running. A visible preview alone is not confirmation of a saved asset.',
  }, {
    title: 'Ergebnisse speichern und finden', question: 'Wo finde ich meine generierten Ergebnisse?',
    text: 'Beachten Sie den angezeigten Ergebnisstatus. Bei einem Bild mit Vorschau bereit müssen Sie vor dem Verlassen der Seite In Assets Manager speichern wählen. Angenommene Hintergrundaufträge laufen auf dem Server weiter und speichern erfolgreiche Ergebnisse automatisch; erfolgreiche Video- und Musikergebnisse werden privat gespeichert. Öffnen Sie den Assets Manager, aktualisieren Sie die neuesten Assets und zeigen Sie bei fehlenden Dateien alle Ordner an. Prüfen Sie Generierungsaufträge, wenn die Verarbeitung noch läuft. Eine sichtbare Vorschau bestätigt allein noch kein gespeichertes Asset.',
  }, ['results', 'Ergebnisse', 'saved', 'gespeichert', 'missing', 'fehlt', 'save', 'speichern']),
  article('asset-organization', ['assets', 'profile'], '/account/assets-manager.html', {
    title: 'Organize private assets', question: 'How do I organize my saved assets?',
    text: 'Use Assets Manager to browse saved images, videos and audio, preview results and organize them in folders. Selection controls offer the actions available for that asset, including rename, move or delete. Use All Assets to clear a folder view and find recent saves. Saved media is private until you explicitly publish eligible content. The assistant cannot read, modify, publish or delete your assets.',
  }, {
    title: 'Private Assets organisieren', question: 'Wie organisiere ich meine gespeicherten Assets?',
    text: 'Im Assets Manager finden Sie gespeicherte Bilder, Videos und Audio, können Ergebnisse ansehen und in Ordnern organisieren. Die Auswahl bietet die für das Asset verfügbaren Aktionen, etwa Umbenennen, Verschieben oder Löschen. Mit Alle Assets lösen Sie die Ordneransicht und finden aktuelle Speicherungen. Gespeicherte Medien bleiben privat, bis Sie geeignete Inhalte ausdrücklich veröffentlichen. Der Assistent kann Ihre Assets nicht lesen, ändern, veröffentlichen oder löschen.',
  }, ['folder', 'Ordner', 'rename', 'umbenennen', 'organize', 'organisieren', 'private assets']),
  article('canvas-start', ['canvas', 'home'], '/canvas/', {
    title: 'Start a Canvas workflow', question: 'How do I start a Canvas workflow?',
    text: 'Sign in and open Canvas. Create a project or choose Text → Image → Video. Add a prompt and generation nodes, connect the output of a source node to the input of the next node, and select a node to edit its model and settings in the Inspector. Run nodes from left to right: a downstream node needs a usable upstream output. Canvas saves positions and settings automatically; check Saved or retry saving if saving failed.',
  }, {
    title: 'Einen Canvas-Workflow starten', question: 'Wie starte ich einen Canvas-Workflow?',
    text: 'Melden Sie sich an und öffnen Sie Canvas. Erstellen Sie ein Projekt oder wählen Sie Text → Bild → Video. Fügen Sie einen Prompt und Generierungs-Nodes hinzu, verbinden Sie den Ausgang eines Quell-Nodes mit dem Eingang des nächsten Nodes und bearbeiten Sie Modell und Einstellungen im Inspector. Führen Sie die Nodes von links nach rechts aus: Ein nachfolgender Node benötigt eine nutzbare Ausgabe des vorherigen Nodes. Canvas speichert Positionen und Einstellungen automatisch; prüfen Sie Gespeichert oder wiederholen Sie bei einem Fehler das Speichern.',
  }, ['Canvas workflow', 'Canvas starten', 'nodes', 'Knoten', 'Inspector', 'graph', 'verbinden']),
  article('canvas-inputs', ['canvas'], '/canvas/', {
    title: 'Connect compatible Canvas inputs', question: 'Why does a Canvas node need an upstream result?',
    text: 'A connection supplies the completed output of another node, not a promise to run it automatically. Run the upstream node first when Canvas reports Needs upstream. Image, video and audio references must be compatible with the selected model and operation. Choose an input method when Canvas requests one. A model shown as Not runnable is not available for that action. Check the specific reason and current controls rather than assuming all models accept all media.',
  }, {
    title: 'Passende Canvas-Inputs verbinden', question: 'Warum benötigt ein Canvas-Node zuerst ein Upstream-Ergebnis?',
    text: 'Eine Verbindung liefert die fertige Ausgabe eines anderen Nodes und führt ihn nicht automatisch aus. Starten Sie zuerst den vorherigen Node, wenn Canvas Upstream ausführen meldet. Bild-, Video- und Audioreferenzen müssen zum gewählten Modell und zur Aktion passen. Wählen Sie eine Eingabemethode, wenn Canvas danach fragt. Ein als Nicht ausführbar markiertes Modell ist für diese Aktion nicht verfügbar. Beachten Sie den konkreten Grund und die aktuellen Einstellungen; nicht jedes Modell nimmt alle Medien an.',
  }, ['upstream', 'compatible', 'kompatibel', 'not runnable', 'nicht ausführbar', 'Canvas input']),
  article('canvas-music-export', ['canvas', 'music', 'video'], '/canvas/', {
    title: 'Preview music and save a Canvas export', question: 'How do I add background music to a Canvas video?',
    text: 'Connect a completed music source for export and choose Add music as background. Select the track and music volume, then use Preview with music when available. This audition does not change a saved video; the original video sound remains. Choose Create full video with background music to produce the export. Download and Save use the last completed export, not the audition. Save full video to Assets when the completed version is ready. If preview fails, the completed video remains available.',
  }, {
    title: 'Musik vorhören und Canvas-Export speichern', question: 'Wie ergänze ich Hintergrundmusik in einem Canvas-Video?',
    text: 'Verbinden Sie eine fertige Musikquelle für den Export und wählen Sie Musik als Hintergrund hinzufügen. Wählen Sie Track und Musiklautstärke und nutzen Sie, wenn verfügbar, Vorschau mit Musik. Dieses Vorhören ändert kein gespeichertes Video; der originale Videoton bleibt erhalten. Mit Gesamtes Video mit Hintergrundmusik erstellen erzeugen Sie den Export. Herunterladen und Speichern verwenden den zuletzt fertigen Export, nicht das Vorhören. Speichern Sie die fertige Version mit Gesamtvideo in Assets speichern. Scheitert die Vorschau, bleibt das fertige Video verfügbar.',
  }, ['background music', 'Hintergrundmusik', 'export', 'preview', 'Vorschau', 'full video', 'Gesamtvideo']),
  article('credit-estimates', ['credits', 'pricing', 'generate-lab', 'canvas'], '/pricing.html', {
    title: 'Understand generation credit estimates', question: 'How many credits does a generation cost?',
    text: 'Generation cost depends on the selected model and supported settings such as quality, dimensions, duration and references. Generate Lab and Canvas show the current estimate before submission. Current server pricing and credit checks determine admission and settlement. The assistant cannot quote an exact generation price without that current configuration, read your balance or confirm a charge. Open the workspace estimate and Credits dashboard; do not infer BITBI credits from a provider’s dollar price.',
  }, {
    title: 'Credit-Schätzungen verstehen', question: 'Wie viele Credits kostet eine Generierung?',
    text: 'Die Kosten hängen vom Modell und unterstützten Einstellungen wie Qualität, Größe, Dauer und Referenzen ab. Generate Lab und Canvas zeigen vor dem Absenden die aktuelle Schätzung. Aktuelle Serverpreise und Credit-Prüfungen bestimmen Annahme und Abrechnung. Der Assistent kann ohne diese aktuelle Konfiguration keinen exakten Generierungspreis nennen, Ihr Guthaben lesen oder eine Abbuchung bestätigen. Nutzen Sie die Schätzung im Workspace und das Credits-Dashboard; aus einem Dollarpreis des Anbieters lässt sich kein BITBI-Creditpreis ableiten.',
  }, ['cost', 'price', 'Kosten', 'Preis', 'credits', 'Guthaben', 'estimate', 'Schätzung']),
  article('plans-and-packs', ['pricing', 'credits'], '/pricing.html', {
    title: 'BITBI Pro and one-time credit packs', question: 'What is the difference between BITBI Pro and credit packs?',
    text: `The current public catalog lists BITBI Pro at ${formatAmount(BITBI_MEMBER_SUBSCRIPTION.amountCents, 'en')} per month, ${BITBI_MEMBER_SUBSCRIPTION.allowanceCredits} subscription credits and ${BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes / 1024 ** 3} GB storage. Subscription credits are topped up to the allowance each billing period, not accumulated beyond it. One-time packs: ${packCopy('en')}. Purchased credits remain separate and additional, and packs do not renew automatically. These are catalog offers, not confirmation that checkout is enabled for your account; review current Pricing and checkout.`,
  }, {
    title: 'BITBI Pro und einmalige Credit-Pakete', question: 'Was unterscheidet BITBI Pro von Credit-Paketen?',
    text: `Der aktuelle öffentliche Katalog führt BITBI Pro für ${formatAmount(BITBI_MEMBER_SUBSCRIPTION.amountCents, 'de')} im Monat mit ${BITBI_MEMBER_SUBSCRIPTION.allowanceCredits} Abo-Credits und ${BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes / 1024 ** 3} GB Speicher. Abo-Credits werden pro Abrechnungszeitraum bis zum Kontingent aufgefüllt und nicht darüber hinaus angesammelt. Einmalige Pakete: ${packCopy('de')}. Gekaufte Credits bleiben separat und zusätzlich; Pakete verlängern sich nicht automatisch. Dies sind Katalogangebote und keine Zusage, dass der Checkout für Ihr Konto verfügbar ist; prüfen Sie Preise und Checkout.`,
  }, ['Pro', 'subscription', 'Abo', 'packs', 'Pakete', 'monthly', 'monatlich', 'storage', 'Speicher']),
  article('billing-recovery', ['credits', 'pricing'], '/account/credits.html', {
    title: 'Payment confirmation and subscription management', question: 'What should I do if purchased credits are not visible yet?',
    text: 'Credits are added after verified payment confirmation. If checkout returns with verification still pending, review Credits and its support reference; do not buy again just to retry confirmation. The assistant cannot confirm payment or refund a charge. Manage BITBI Pro on Credits: cancellation is scheduled for the end of the paid period, and benefits remain until then. Purchased credits stay separate. Use the site’s Contact form for unresolved account-specific billing questions without posting card details here.',
  }, {
    title: 'Zahlungsbestätigung und Abo-Verwaltung', question: 'Was mache ich, wenn gekaufte Credits noch fehlen?',
    text: 'Credits werden nach bestätigter Zahlung gutgeschrieben. Steht nach der Rückkehr vom Checkout die Prüfung noch aus, prüfen Sie Credits und die dortige Support-Referenz; kaufen Sie nicht erneut, nur um die Bestätigung zu wiederholen. Der Assistent kann keine Zahlung bestätigen oder erstatten. Verwalten Sie BITBI Pro unter Credits: Eine Kündigung wird zum Ende des bezahlten Zeitraums vorgemerkt; die Leistungen bleiben bis dahin bestehen. Gekaufte Credits bleiben separat. Nutzen Sie bei ungeklärten persönlichen Abrechnungsfragen das Kontaktformular und senden Sie hier keine Kartendaten.',
  }, ['payment', 'Zahlung', 'paid', 'bezahlt', 'cancel subscription', 'Abo kündigen', 'refund', 'Erstattung']),
  article('session-recovery', ['profile', 'generate-lab', 'canvas', 'assets'], '/generate-lab/', {
    title: 'Recover from an expired session', question: 'What should I do when my session expires?',
    text: 'Sign in again using the displayed recovery action, then check that you are in the intended account. Generate Lab preserves the current prompt and settings when a session check prevents submission. A session-check failure is different from an already accepted generation: check the job status before submitting again. The assistant cannot sign in for you or inspect your session, private jobs or credentials. Never send passwords or recovery links in chat.',
  }, {
    title: 'Nach abgelaufener Sitzung fortfahren', question: 'Was mache ich, wenn meine Sitzung abgelaufen ist?',
    text: 'Melden Sie sich über die angezeigte Wiederherstellung erneut an und prüfen Sie das richtige Konto. Generate Lab behält den aktuellen Prompt und die Einstellungen, wenn die Sitzungsprüfung das Absenden verhindert. Eine fehlgeschlagene Sitzungsprüfung ist nicht dasselbe wie eine bereits angenommene Generierung: Prüfen Sie vor erneutem Absenden den Auftragsstatus. Der Assistent kann Sie nicht anmelden und weder Ihre Sitzung noch private Aufträge oder Zugangsdaten einsehen. Senden Sie keine Passwörter oder Wiederherstellungslinks im Chat.',
  }, ['session', 'Sitzung', 'login', 'sign in', 'anmelden', 'expired', 'abgelaufen']),
  article('generation-recovery', ['generate-lab', 'assets', 'video', 'music'], '/account/assets-manager.html', {
    title: 'A generation is still processing or needs attention', question: 'What should I do if generation is still processing?',
    text: 'For an accepted job, processing continues on the server even if you close the page. Open Generation jobs or refresh Assets Manager to observe the existing request. If the outcome is unknown or needs review, do not submit another paid generation to recover it. A saved medium with a failed preview is different from a failed generation: use Retry preview only when offered. A browser playback failure does not prove the saved file is missing. Keep the shown support reference for Contact.',
  }, {
    title: 'Generierung läuft oder benötigt Prüfung', question: 'Was mache ich, wenn die Generierung noch läuft?',
    text: 'Ein angenommener Auftrag läuft auf dem Server weiter, auch wenn Sie die Seite schließen. Öffnen Sie Generierungsaufträge oder aktualisieren Sie den Assets Manager, um die vorhandene Anfrage zu prüfen. Bei unbekanntem oder zu prüfendem Ergebnis starten Sie keine weitere kostenpflichtige Generierung zur Wiederherstellung. Ein gespeichertes Medium mit fehlgeschlagener Vorschau unterscheidet sich von einer fehlgeschlagenen Generierung: Nutzen Sie, falls angeboten, nur Vorschau erneut versuchen. Ein Wiedergabefehler im Browser beweist nicht, dass die gespeicherte Datei fehlt. Bewahren Sie die angezeigte Support-Referenz für Kontakt auf.',
  }, ['processing', 'Verarbeitung', 'stuck', 'hängt', 'failed', 'fehlgeschlagen', 'pending', 'ausstehend', 'retry']),
  article('public-help-boundary', ['privacy', 'profile', 'legal', 'contact'], '/legal/privacy.html', {
    title: 'Public help and your private account', question: 'Can the assistant see my account or private assets?',
    text: 'This AI assistant provides public BITBI product guidance. It does not read your account balance, private assets, Canvas projects, form values, jobs or administration data, and cannot perform account actions. Only the page category and language are used for page-aware help, together with messages you choose to send. Do not include secrets, personal documents or payment details. AI answers can be wrong; check the linked BITBI source. The Privacy Policy describes processing and contact options; do not assume EU-only processing from a model’s origin.',
  }, {
    title: 'Öffentliche Hilfe und Ihr privates Konto', question: 'Kann der Assistent mein Konto oder private Assets sehen?',
    text: 'Dieser KI-Assistent erklärt öffentliche BITBI-Funktionen. Er liest weder Guthaben, private Assets, Canvas-Projekte, Formularwerte, Aufträge noch Administrationsdaten und kann keine Kontoaktionen ausführen. Für seitenbezogene Hilfe werden nur Seitenkategorie und Sprache sowie Ihre selbst gesendeten Nachrichten verwendet. Senden Sie keine Geheimnisse, persönlichen Dokumente oder Zahlungsdaten. KI-Antworten können falsch sein; prüfen Sie die verlinkte BITBI-Quelle. Die Datenschutzerklärung erläutert Verarbeitung und Kontaktmöglichkeiten; die Herkunft eines Modells garantiert keine Verarbeitung ausschließlich in der EU.',
  }, ['privacy', 'Datenschutz', 'private', 'personal', 'persönlich', 'data', 'Daten', 'EU', 'account balance']),
  article('contact-support', ['contact', 'legal', 'privacy'], '/#contact', {
    title: 'Contact BITBI', question: 'How do I contact BITBI about an unresolved problem?',
    text: 'Use Contact on the homepage for questions the public assistant cannot resolve. Describe the affected feature, what you expected, and the displayed error or support reference. Do not include passwords, full card numbers or private media in this chat. Account-specific payment, ownership and access decisions require the appropriate support or account flow. Current legal and privacy information is linked in the site footer.',
  }, {
    title: 'BITBI kontaktieren', question: 'Wie kontaktiere ich BITBI bei einem ungelösten Problem?',
    text: 'Nutzen Sie Kontakt auf der Startseite für Fragen, die der öffentliche Assistent nicht klären kann. Beschreiben Sie die betroffene Funktion, das erwartete Verhalten und die angezeigte Fehlermeldung oder Support-Referenz. Senden Sie in diesem Chat keine Passwörter, vollständigen Kartennummern oder privaten Medien. Persönliche Zahlungs-, Eigentums- und Zugangsentscheidungen gehören in den passenden Support- oder Kontoprozess. Aktuelle Rechts- und Datenschutzhinweise sind im Seitenfuß verlinkt.',
  }, ['contact', 'Kontakt', 'support', 'human', 'Mensch', 'problem', 'Hilfe']),
]);
