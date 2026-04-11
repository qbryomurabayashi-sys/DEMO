import { prebuiltAppConfig } from "@mlc-ai/web-llm";
console.log(JSON.stringify(prebuiltAppConfig.model_list.find(x => x.model_id === 'gemma-2-2b-it-q4f16_1-MLC'), null, 2));
