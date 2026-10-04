// Accepted recipe / completion metadata, not an editable audio setting.
export const CANVAS_AUDIO_FIT_POLICY='fit-picture-v1';
export function validAudioFit(fit) {
    return fit && Object.keys(fit).sort().join(',')==='policy,trimEnd,trimStart'
        && fit.policy===CANVAS_AUDIO_FIT_POLICY
        && [fit.trimStart,fit.trimEnd].every(n=>Number.isFinite(n)&&n>=0&&n<=600);
}
export const audioWasFitted=fit=>validAudioFit(fit)&&(fit.trimStart>1/48000||fit.trimEnd>1/48000);
export function cutSafeAudio(value,fit) {
    if(!validAudioFit(fit))return value;
    return {...value,fadeIn:value?.fadeIn||(fit.trimStart > 1/48000 ? .005 : 0),fadeOut:value?.fadeOut||(fit.trimEnd > 1/48000 ? .005 : 0)};
}
export function audioFitResultText(timeline,german=false) {
    const count=timeline?.filter(clip=>audioWasFitted(clip.originalAudioFit)).length||0;
    return count?(german?`Originalton bei ${count} Clips auf die Bilddauer gekürzt. Quelldateien unverändert.`
        :`Original audio trimmed to picture duration in ${count} clips. Source files unchanged.`):'';
}
