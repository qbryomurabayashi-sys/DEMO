import { prebuiltAppConfig } from '@mlc-ai/web-llm';
const gemma4Models = prebuiltAppConfig.model_list.filter(m => m.model_id.toLowerCase().includes('gemma-4'));
console.log('Gemma 4 models found in official config:', gemma4Models.length);
if(gemma4Models.length > 0) {
  console.log(gemma4Models.map(m => m.model_id));
}
