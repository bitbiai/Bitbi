import worker from '../../../workers/ai/src/index.js';

// Exercise the actual signed AI readiness endpoint. This native Voice journey
// only admits production; it must never dispatch its paid planning/media work.
export default {
  fetch(request,env,ctx){
    if(request.method!=='GET'||new URL(request.url).pathname!=='/internal/ai/canvas-agent/readiness')
      throw new Error('Native Voice acceptance permits readiness, never inference');
    return worker.fetch(request,{...env,AI:{run(){throw new Error('Readiness cannot invoke a model');}}},ctx);
  },
};
