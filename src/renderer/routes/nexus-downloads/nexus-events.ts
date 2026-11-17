export const NEXUS_ADD_EVENT = 'nexus-open-add'

export function openNexusAdd(input?: string): void {
  window.dispatchEvent(new CustomEvent(NEXUS_ADD_EVENT, { detail: input }))
}
