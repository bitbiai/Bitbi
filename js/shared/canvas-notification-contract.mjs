import { h3ReferenceError } from './minimax-h3.mjs';
// Presentation only. Notification codes and read markers never authorize work.
export const CANVAS_CLIENT_NOTIFICATION_CODES = Object.freeze([
    'canvas_client_notice', 'canvas_project_created', 'canvas_project_deleted', 'canvas_project_renamed',
    'canvas_project_saved', 'canvas_node_added', 'canvas_node_deleted', 'canvas_connection_created',
    'canvas_connection_deleted', 'canvas_run_complete', 'canvas_asset_saved', 'canvas_save_failed',
    'canvas_request_failed', 'request_failed', 'network_error', 'request_timeout', 'request_aborted',
    'canvas_connection_interrupted', 'canvas_connection_recovered', 'canvas_brief_saved',
    'canvas_brief_cleared', 'canvas_brief_cancelled', 'canvas_allowance_accepted',
    'canvas_production_started', 'canvas_action_completed', 'canvas_action_failed',
    'canvas_project_delete_unconfirmed', 'canvas_cleanup_pending', 'canvas_export_ready',
    'canvas_export_failed', 'canvas_export_waiting', 'canvas_export_observation_interrupted',
    'canvas_pricing_stale', 'canvas_project_changed', 'canvas_node_saved', 'canvas_assembly_saved',
]);
const messages = {
    canvas_project_created: ['Project created.', 'Projekt erstellt.'],
    canvas_project_deleted: ['Project removed. Independently saved assets are retained.', 'Projekt entfernt. Separat gespeicherte Assets bleiben erhalten.'],
    canvas_project_renamed: ['Project name saved.', 'Projektname gespeichert.'],
    canvas_project_saved: ['Project saved.', 'Projekt gespeichert.'],
    canvas_node_added: ['Node added.', 'Knoten hinzugefügt.'],
    canvas_node_deleted: ['Node removed.', 'Knoten entfernt.'],
    canvas_node_saved: ['Node settings saved. Existing generated media is unchanged.', 'Knoteneinstellungen gespeichert. Bereits erzeugte Medien bleiben unverändert.'],
    canvas_assembly_saved: ['Assembly saved. Export again to apply the changes to a video.', 'Montage gespeichert. Exportiere erneut, um die Änderungen im Video zu übernehmen.'],
    canvas_connection_created: ['Connection added.', 'Verbindung hinzugefügt.'],
    canvas_connection_deleted: ['Connection removed.', 'Verbindung entfernt.'],
    canvas_run_complete: ['Generated output saved.', 'Erzeugtes Ergebnis gespeichert.'],
    canvas_asset_saved: ['Output saved to Assets.', 'Ergebnis in Assets gespeichert.'],
    canvas_save_failed: ['The save could not be confirmed. Check the current project before repeating it.', 'Das Speichern konnte nicht bestätigt werden. Prüfe den aktuellen Projektstand vor einer Wiederholung.'],
    canvas_project_delete_unconfirmed: ['Project removal could not be confirmed. The displayed project state is retained.', 'Die Projektlöschung konnte nicht bestätigt werden. Der angezeigte Projektstand bleibt erhalten.'],
    canvas_cleanup_pending: ['The change is saved. Background media cleanup is pending; no repeat action is needed.', 'Die Änderung ist gespeichert. Die Medienbereinigung steht noch aus; die Aktion muss nicht wiederholt werden.'],
    canvas_connection_interrupted: ['The connection was interrupted. Existing accepted work continues independently.', 'Die Verbindung wurde unterbrochen. Bereits angenommene Arbeit läuft unabhängig weiter.'],
    canvas_connection_recovered: ['Connected again. Existing requests are being observed.', 'Wieder verbunden. Bestehende Aufträge werden weiter beobachtet.'],
    canvas_brief_saved: ['Project brief saved.', 'Projektidee gespeichert.'],
    canvas_brief_cleared: ['Conversation and creative brief cleared.', 'Gespräch und Projektidee geleert.'],
    canvas_brief_cancelled: ['Briefing stopped. Accepted work and its costs are retained.', 'Briefing beendet. Bereits angenommene Arbeit und ihre Kosten bleiben erhalten.'],
    canvas_allowance_accepted: ['Conversation allowance saved. This is separate from the production cap.', 'Gesprächsbudget gespeichert. Es ist vom Produktionslimit getrennt.'],
    canvas_production_started: ['Production accepted.', 'Produktion angenommen.'],
    canvas_decision_declined: ['The proposed authorization was declined. Existing authorizations remain unchanged.', 'Die vorgeschlagene Freigabe wurde abgelehnt. Bestehende Freigaben bleiben unverändert.'],
    canvas_start_requested: ['The production request is saved. Required preparation and authorization are still being checked.', 'Der Produktionswunsch ist gespeichert. Erforderliche Vorbereitung und Freigabe werden noch geprüft.'],
    canvas_start_approval_required: ['The production request needs your explicit spending authorization in the conversation.', 'Der Produktionswunsch benötigt im Gespräch deine ausdrückliche Ausgabenfreigabe.'],
    canvas_start_cancelled: ['The pending production request was stopped. No new production is started by this request.', 'Der vorgemerkte Produktionswunsch wurde gestoppt. Dieser Wunsch startet keine neue Produktion.'],
    canvas_action_completed: ['The requested action completed.', 'Die angeforderte Aktion ist abgeschlossen.'],
    canvas_action_failed: ['The action needs attention. Check its diagnostic details before repeating it.', 'Die Aktion benötigt Aufmerksamkeit. Prüfe die Diagnose vor einer Wiederholung.'],
    canvas_export_ready: ['The final video is saved. A pending poster does not prevent playback.', 'Das fertige Video ist gespeichert. Ein ausstehendes Vorschaubild verhindert die Wiedergabe nicht.'],
    canvas_export_waiting: ['The export is waiting for media processing.', 'Der Export wartet auf die Medienverarbeitung.'],
    canvas_export_processing: ['The accepted export is being processed.', 'Der angenommene Export wird verarbeitet.'],
    canvas_export_failed: ['The export could not finish. Its existing sources and previous exports are retained.', 'Der Export konnte nicht abgeschlossen werden. Vorhandene Quellen und frühere Exporte bleiben erhalten.'],
    canvas_export_observation_interrupted: ['Export status could not be read. Observation will reconnect without another render.', 'Der Exportstatus konnte nicht gelesen werden. Die Beobachtung verbindet sich ohne neuen Renderauftrag erneut.'],
    canvas_trim_outside_source: ['A selected clip trim exceeds the actual source duration. Correct the trim in the assembly before exporting again.', 'Ein gewählter Clipausschnitt überschreitet die tatsächliche Quelldauer. Korrigiere den Schnitt in der Montage vor einem neuen Export.'],
    media_delivery_exhausted: ['Media processing could not be started after bounded retries. The existing request needs a verified recovery.', 'Die Medienverarbeitung konnte nach begrenzten Versuchen nicht gestartet werden. Der bestehende Auftrag benötigt eine geprüfte Wiederherstellung.'],
    canvas_agent_plan_correction_exhausted: ['The plan still failed validation after the allowed corrections. Review the reported constraints; no new generation was authorized by this notice.', 'Der Plan bestand die Prüfung auch nach den zulässigen Korrekturen nicht. Prüfe die genannten Einschränkungen; diese Meldung gibt keine neue Generierung frei.'],
    canvas_agent_trim_outside_planned_source: ['The planned clip selection extends beyond its source duration. The plan needs a valid clip length before production can continue.', 'Der geplante Clipausschnitt reicht über die Quelldauer hinaus. Der Plan braucht eine gültige Cliplänge, bevor die Produktion fortgesetzt werden kann.'],
    canvas_image_save_pending: ['The image was generated; saving it is still pending. Do not generate a replacement while its storage is being reconciled.', 'Das Bild wurde erzeugt; das Speichern steht noch aus. Erzeuge keinen Ersatz, während die Speicherung abgeglichen wird.'],
    canvas_image_save_unavailable: ['The image could not yet be saved. Its existing generation receipt must be checked before another generation.', 'Das Bild konnte noch nicht gespeichert werden. Vor einer neuen Generierung muss der vorhandene Ergebnisbeleg geprüft werden.'],
    canvas_agent_project_changed: ['The project was changed. Production needs to be reconciled with the current editable project.', 'Das Projekt wurde geändert. Die Produktion muss mit dem aktuellen bearbeitbaren Projekt abgeglichen werden.'],
    canvas_agent_budget_request_changed: ['This budget request no longer matches the current project or cap. It can no longer be approved.', 'Diese Budgetanfrage passt nicht mehr zum aktuellen Projekt oder Limit. Sie kann nicht mehr freigegeben werden.'],
    canvas_agent_authorization_expired: ['Production authorization has expired. Accepted work remains recorded; continuing requires a valid decision.', 'Die Produktionsfreigabe ist abgelaufen. Angenommene Arbeit bleibt dokumentiert; eine Fortsetzung braucht eine gültige Entscheidung.'],
    canvas_agent_receipt_review_required: ['A recorded provider result needs review before the next step. Do not start another request to replace it.', 'Ein gespeichertes Anbieterergebnis muss vor dem nächsten Schritt geprüft werden. Starte keinen Ersatzauftrag dafür.'],
    canvas_agent_action_confirmation_required: ['A decision is waiting for your explicit confirmation in the conversation.', 'Eine Entscheidung wartet im Gespräch auf deine ausdrückliche Bestätigung.'],
    canvas_agent_action_review_required: ['The action outcome needs review. It will not be repeated automatically.', 'Das Ergebnis der Aktion muss geprüft werden. Sie wird nicht automatisch wiederholt.'],
    canvas_agent_action_failed: ['The requested change could not be applied.', 'Die gewünschte Änderung konnte nicht angewendet werden.'],
    canvas_agent_action_completed: ['The requested action completed.', 'Die angeforderte Aktion ist abgeschlossen.'],
    canvas_agent_action_pending: ['The action was accepted; its result is still pending.', 'Die Aktion wurde angenommen; ihr Ergebnis steht noch aus.'],
    model_pricing_stale: ['Prices changed. Review the current quote before approving.', 'Preise wurden geändert. Prüfe die aktuelle Schätzung vor der Freigabe.'],
    network_error: ['The response could not be received. The outcome is unconfirmed; check the existing request.', 'Die Antwort konnte nicht empfangen werden. Der Ausgang ist unbestätigt; prüfe den bestehenden Auftrag.'],
    request_timeout: ['The response timed out. This does not prove that the action failed.', 'Die Antwort hat das Zeitlimit überschritten. Das beweist nicht, dass die Aktion fehlgeschlagen ist.'],
    project_not_found: ['The project is no longer available to this account. Refresh the project list.', 'Das Projekt ist für dieses Konto nicht mehr verfügbar. Aktualisiere die Projektliste.'],
    unauthorized: ['Sign in again to access your Canvas notifications.', 'Melde dich erneut an, um deine Canvas-Meldungen abzurufen.'],
};
const phases = {
    started: ['Production accepted.', 'Produktion angenommen.'], planning: ['Planning request accepted.', 'Planungsauftrag angenommen.'],
    proposed: ['The saved plan is being checked.', 'Der gespeicherte Plan wird geprüft.'], applied: ['Editable Canvas nodes created.', 'Bearbeitbare Canvas-Knoten erstellt.'],
    generating: ['Media request accepted.', 'Medienauftrag angenommen.'], exporting: ['Full-video export accepted.', 'Gesamtvideo-Export angenommen.'],
    completed: ['Production completed with a saved result.', 'Produktion mit gespeichertem Ergebnis abgeschlossen.'],
    paused: ['Production paused.', 'Produktion pausiert.'], cancelled: ['Production stopped. Already accepted work is retained.', 'Produktion gestoppt. Bereits angenommene Arbeit bleibt erhalten.'],
    taken_over: ['Manual control enabled.', 'Manuelle Kontrolle übernommen.'], budget: ['Production is waiting for a budget decision.', 'Die Produktion wartet auf eine Budgetentscheidung.'],
    repairing: ['A bounded plan correction was accepted.', 'Eine begrenzte Plankorrektur wurde angenommen.'],
    technical_only: ['Review is technical only; no visual model review was performed.', 'Die Prüfung ist rein technisch; eine visuelle Modellprüfung wurde nicht durchgeführt.'],
};
const actionLabels = {
    brief_save: ['Save project brief', 'Projektidee speichern'], brief_resume: ['Resume briefing', 'Briefing fortsetzen'],
    brief_cancel: ['Stop briefing', 'Briefing beenden'], skip_questions: ['Finish optional questions', 'Optionale Fragen beenden'],
    delegate_duration: ['Delegate duration choice', 'Dauerwahl übertragen'], start_now: ['Start production', 'Produktion starten'],
    production_pause: ['Pause production', 'Produktion pausieren'], production_resume: ['Resume production', 'Produktion fortsetzen'],
    production_cancel: ['Stop production', 'Produktion stoppen'], production_takeover: ['Take manual control', 'Manuelle Kontrolle übernehmen'],
    allowance_propose: ['Conversation allowance', 'Gesprächsbudget'], budget_accept: ['Production budget decision', 'Produktionsbudget entscheiden'],
    budget_decline: ['Decline budget proposal', 'Budgetvorschlag ablehnen'], conversation_clear: ['Clear conversation', 'Gespräch leeren'],
    clip_remove: ['Remove clip', 'Clip entfernen'], clip_order: ['Reorder clips', 'Clips umordnen'], clip_add: ['Add clip', 'Clip hinzufügen'],
    clip_replace: ['Replace clip', 'Clip ersetzen'], clip_trim: ['Trim clip', 'Clip zuschneiden'],
    transition: ['Change transition', 'Übergang ändern'], transition_strength: ['Change transition strength', 'Übergangsstärke ändern'],
    music_volume: ['Music volume', 'Musiklautstärke'], music_enabled: ['Background music', 'Hintergrundmusik'],
    music_fade_in: ['Music fade-in', 'Musik einblenden'], music_fade_out: ['Music fade-out', 'Musik ausblenden'],
    music_source: ['Music source', 'Musikquelle'], smooth_joins: ['Smooth clip joins', 'Clipübergänge glätten'],
    node_prompt: ['Change node prompt', 'Knotenprompt ändern'], node_model: ['Change generation model', 'Generierungsmodell ändern'],
    node_parameter: ['Change model setting', 'Modelleinstellung ändern'],
    original_audio_volume: ['Original audio volume', 'Originaltonlautstärke'], original_audio_enabled: ['Original audio', 'Originalton'],
    original_audio_fade_in: ['Original audio fade-in', 'Originalton einblenden'], original_audio_fade_out: ['Original audio fade-out', 'Originalton ausblenden'],
    regenerate: ['Generate new variant', 'Neue Variante erzeugen'], export: ['Export video', 'Video exportieren'], save_result: ['Save output to Assets', 'Ergebnis in Assets speichern'],
};
export function canvasNotificationText(item, german = false) {
    if(item?.code==='canvas_project_delete_unconfirmed')return messages.canvas_project_delete_unconfirmed[german?1:0];
    const code = item?.details?.errorCode || item?.code;
    const referenceError = h3ReferenceError(code,german);
    if (referenceError) return referenceError;
    const pair = messages[code] || (item?.source === 'event' ? phases[code] : null);
    const label = item?.source === 'action' ? actionLabels[item?.details?.actionType]?.[german ? 1 : 0] : '';
    if (pair) return `${label ? `${label}: ` : ''}${pair[german ? 1 : 0]}`;
    if (item?.status === 401) return messages.unauthorized[german ? 1 : 0];
    if (item?.severity === 'error' || item?.severity === 'warning') return german
        ? 'Dieser Canvas-Vorgang benötigt Aufmerksamkeit. Die Diagnose enthält den bekannten Fehlercode; ein unbekannter Ausgang wird nicht automatisch wiederholt.'
        : 'This Canvas operation needs attention. The diagnostic details contain the known error code; an unknown outcome is not automatically repeated.';
    return german ? 'Eine Canvas-Aktualisierung liegt vor. Details zeigen den betroffenen Vorgang.' : 'A Canvas update is available. Details identify the affected operation.';
}
