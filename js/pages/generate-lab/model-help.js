import { getCurrentLocale, localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';
import { GENERATE_LAB_MEDIA_TYPES, getGenerateLabModelsByMediaType } from './model-registry.js?v=__ASSET_VERSION__';

// Membership, capabilities and settings come from the same registry as the form.
// This renders information only: it neither prices nor submits requests.
export function renderWorkspaceModelHelp() {
    const de = getCurrentLocale() === 'de';
    const copy = (en, german) => de ? german : en;
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    const root = element('div', 'help-menu__items');
    root.dataset.helpModels = '';
    const optionLabels = {
        quality: copy('Quality', 'Qualität'), size: copy('Requested size', 'Angeforderte Größe'),
        outputFormat: copy('File format', 'Dateiformat'), background: copy('Background', 'Hintergrund'),
        resolution: copy('Requested resolution', 'Angeforderte Auflösung'),
        ratio: copy('Aspect ratio', 'Seitenverhältnis'), aspectRatio: copy('Aspect ratio', 'Seitenverhältnis'),
        duration: copy('Requested duration (seconds)', 'Angeforderte Dauer (Sekunden)'),
        safetyTolerance: copy('Safety tolerance', 'Sicherheitstoleranz'),
    };
    for (const mode of GENERATE_LAB_MEDIA_TYPES) {
        const models = getGenerateLabModelsByMediaType(mode.id);
        if (!models.length) continue;
        root.append(element('h4', 'help-menu__section-title', mode.label));
        for (const model of models) {
            const item = element('details', 'help-menu__item');
            item.dataset.helpModel = model.id;
            const summary = element('summary', 'help-menu__item-summary');
            summary.append(element('span', 'help-menu__item-title', model.displayName));
            summary.append(element('span', 'help-menu__item-copy', model.summary));
            const body = element('div', 'help-menu__item-body');
            const paragraph = (text) => body.append(element('p', 'help-menu__item-detail', text));
            paragraph(copy('Required: a prompt. ', 'Erforderlich: ein Prompt. ') + mode.promptHelp);
            const controls = model.controls || {};
            if (controls.supportsVideoInput) {
                paragraph(copy('Generate accepts text and up to ten saved image references. Edit and Extend are temporarily unavailable pending billing verification for this Cloudflare route. Their saved inputs are retained. Private inputs remain authorized for the accepted job. Size is a requested shape, not a promise of 1080p output; the resolution selector is authoritative.', 'Generieren verwendet Text und bis zu zehn gespeicherte Bildreferenzen. Bearbeiten und Verlängern sind bis zur Abrechnungsprüfung dieser Cloudflare-Route vorübergehend nicht verfügbar. Gespeicherte Eingaben bleiben erhalten. Private Eingaben bleiben für den angenommenen Auftrag autorisiert. Größe bezeichnet die angeforderte Form und garantiert keine 1080p-Ausgabe; maßgeblich ist die Auflösungsauswahl.'));
            } else if (controls.supportsReferenceImages) {
                paragraph(copy(
                    `Up to ${controls.maxReferenceImages} optional saved or uploaded reference images (PNG, JPEG, WebP). Reference inputs affect the existing estimate.`,
                    `Bis zu ${controls.maxReferenceImages} optionale gespeicherte oder hochgeladene Referenzbilder (PNG, JPEG, WebP). Referenzen beeinflussen die bestehende Schätzung.`,
                ));
            } else if (controls.supportsImageInput) {
                paragraph(copy('One optional saved or uploaded image for image-to-video. No video reference input.', 'Ein optionales gespeichertes oder hochgeladenes Bild für Bild-zu-Video. Keine Videoreferenz als Eingabe.'));
            } else if (mode.id !== 'music') {
                paragraph(copy('Text input only in this workspace; no reference media input.', 'In diesem Workspace nur Texteingabe; keine Referenzmedien als Eingabe.'));
            }
            if (controls.supportsReferenceImages) paragraph(localeText('generateLab.referenceImagesTooLarge'));
            if (controls.supportsImageInput) paragraph(localeText('studio.referenceImageTooLarge'));
            for (const [key, value] of Object.entries(model.options || {})) {
                if (key === 'dimensions') {
                    paragraph(copy(
                        `Requested width and height: ${value.min}–${value.max} px; at most ${value.maxPixels} pixels in total.`,
                        `Angeforderte Breite und Höhe: ${value.min}–${value.max} px; insgesamt höchstens ${value.maxPixels} Pixel.`,
                    ));
                } else if (optionLabels[key]) {
                    const values = Array.isArray(value) ? value.join(', ') : `${value.min}–${value.max}`;
                    paragraph(`${optionLabels[key]}: ${values}.`);
                }
            }
            if (controls.supportsSteps) paragraph(copy('Steps can be selected in the form.', 'Steps können im Formular gewählt werden.'));
            if (controls.supportsSeed) paragraph(copy('Optional seed; leaving it blank uses a random seed.', 'Optionaler Seed; ohne Angabe wird ein zufälliger Seed verwendet.'));
            if (controls.supportsNegativePrompt) paragraph(copy('Optional negative prompt to describe unwanted content.', 'Optionaler negativer Prompt für unerwünschte Inhalte.'));
            if (controls.supportsAudioToggle) paragraph(copy('Generated audio can be enabled or disabled.', 'Generierter Ton kann ein- oder ausgeschaltet werden.'));
            if (controls.supportsWatermark) paragraph(copy('Optional watermark setting.', 'Optionale Wasserzeichen-Einstellung.'));
            if (controls.supportsBackground) paragraph(copy('Transparent background is not supported by this model here.', 'Transparenter Hintergrund wird von diesem Modell hier nicht unterstützt.'));
            if (controls.maxPromptLength) paragraph(copy(`Model prompt limit: ${controls.maxPromptLength} characters; the form may impose a smaller limit.`, `Modell-Promptlimit: ${controls.maxPromptLength} Zeichen; das Formular kann eine kleinere Grenze setzen.`));
            if (mode.id === 'music') {
                paragraph(copy('Optional manual lyrics, instrumental mode or generated lyrics. Instrumental mode disables lyrics; manual and generated lyrics are alternatives. No audio reference, duration or output-format selector is offered here.', 'Optionale eigene Lyrics, Instrumentalmodus oder generierte Lyrics. Der Instrumentalmodus deaktiviert Lyrics; eigene und generierte Lyrics sind Alternativen. Hier gibt es keine Audioreferenz-, Dauer- oder Ausgabeformatauswahl.'));
            }
            item.append(summary, body);
            root.append(item);
        }
    }
    return root;
}
