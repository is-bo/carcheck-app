export type { ContractDamageItem, RentalContext } from './context';
export { sampleRentalContext } from './context';
export {
  damageItemText,
  damageListHtml,
  damageSummaryText,
  PHOTO_URI_PREFIX,
  SIGNATURE_URI,
} from './damageList';
export { escapeHtml, formatContractDate, formatContractDateTime, formatDistance, formatFuel } from './format';
export type { ContractBlock, ContractInline, ContractRenderResult } from './render';
export { contractHtmlProblems, contractHtmlReferences, inspectContractTemplate, renderContractTemplate } from './render';
export {
  isStarterTemplate,
  STARTER_TEMPLATE_BODY,
  STARTER_TEMPLATE_KEY,
  STARTER_TEMPLATE_NOTICE,
  STARTER_TEMPLATE_TITLE,
} from './starterTemplate';
export type { ContractVariable, ContractVariableGroup } from './variables';
export { CONTRACT_VARIABLE_GROUPS, CONTRACT_VARIABLES, getContractVariable, resolveAllVariables } from './variables';
