import {execFileSync} from 'node:child_process';

const files=['js/pages/canvas/main.js','js/pages/canvas/full-video.js','js/pages/canvas/graph.js','css/pages/canvas.css'];
export function canvasInspectorSources(base,head,cwd=process.cwd()) {
  try {
    const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    const ancestor=git(['merge-base',base,head]).trim();
    return Object.fromEntries(files.map(file=>[file,{before:git(['show',`${ancestor}:${file}`]),after:git(['show',`${head}:${file}`])}]));
  } catch { return null; }
}

// Only presentation wiring may use the small Inspector acceptance scope. A
// neighbouring mutation, request, graph algorithm or audio/export edit widens it.
function withoutPresentation(source,file) {
  if(file.endsWith('.css')) return source.split('\n').filter(line=>!/^  \.canvas-(?:disclosure|generation-settings|merge-settings|node.*__icon)/.test(line)).join('\n');
  source=source.replace(/^import .*from '\.\/(?:inspector-disclosure|media-icon)\.js[^']*';\n/gm,'');
  if(file.endsWith('/main.js')) return source.replace('    rememberCanvasDisclosures(dom.inspector);\n','')
    .replace('inspectorRunError(node) || videoState.message','videoState.message')
    .replace("    inspectorRunError(node, '');\n",'').replace('        inspectorRunError(node, errorMessage(result));\n','')
    .replace("            const label = isGerman ? 'Zusätzlicher Prompt' : 'Additional prompt';\n            const editor = canvasDisclosure([store.state.project.id, node.id, 'prompt'], label, 'canvas-additional-prompt');\n            editor.className = 'canvas-additional-prompt';\n            editor.append(field(label, prompt));", "            const editor = el('details', 'canvas-additional-prompt');\n            const label = isGerman ? 'Zusätzlicher Prompt' : 'Additional prompt';\n            editor.append(el('summary', '', label), field(label, prompt));")
    .replace(/        if \(hasCompletedMedia\(node\)\) \{\n            const settings = canvasDisclosure\([^\n]+\n            const content = el\('div', 'canvas-generation-settings__body'\);\n            content\.append\(\.\.\.\[\.\.\.dom\.inspector\.children\]\.filter\(child => child !== status\)\);\n            settings\.append\(content\); dom\.inspector\.prepend\(settings\);\n        }\n/,'');
  if(file.endsWith('/full-video.js')) return source
    .replace(/    const nodeId=output\.nodeId\|\|getGraph\(\)\.nodes\.find\(node=>node\.output\?\.runId===output\.runId\)\?\.id\|\|output\.runId;\n    const mergeSettings=canvasDisclosure\([^\n]+\n    controls\.append\(mergeSettings\);\n/,'')
    .replace('clipSequence(mergeSettings,','clipSequence(controls,').replace('parent:mergeSettings,','parent:controls,');
  return source.replace("const media=node.type==='asset_reference' && node.content?.asset?.id===node.asset_id && node.content.asset.availability!=='unavailable'?canvasNodeMediaKind(node):null;","const media=node.type==='asset_reference'?canvasNodeMediaKind(node):null;")
    .replace(/        const iconKind = node\.type === 'asset_reference'[^\n]+\n/,'')
    .replace("iconKind ? canvasMediaIcon(iconKind) : element('span', 'canvas-node__mark')","element('span', 'canvas-node__mark')");
}
export function isCanvasInspectorChange(sources) {
  return files.every(file=>sources?.[file]?.before && sources[file].after && withoutPresentation(sources[file].before,file)===withoutPresentation(sources[file].after,file));
}
