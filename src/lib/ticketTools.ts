import {
  priorities,
  difficulties,
  statuses,
  prerequisiteIds,
  type Ticket,
  type TicketInput,
} from '../domain'

/** Duplication creates fresh work; project-specific relationships never cross projects. */
export function duplicateTicket(input: TicketInput, projectId: string): TicketInput {
  const sameProject = input.project_id === projectId
  return {
    project_id: projectId,
    title: input.title,
    description: input.description,
    priority: input.priority,
    difficulty: input.difficulty,
    status: 'todo',
    position: 0,
    parent_id: sameProject ? input.parent_id || null : null,
    prerequisite_ids: sameProject ? [...prerequisiteIds(input)] : [],
    depends_on_id: sameProject ? prerequisiteIds(input)[0] || null : null,
  }
}

export function ticketMarkdown(
  ticket: TicketInput & { number?: number },
  projectName: string,
  tickets: Ticket[],
): string {
  const heading = (value: string) => value.replace(/[\r\n]+/g, ' ')
  const ref = (id: string) => {
    const related = tickets.find(
      (candidate) => candidate.id === id && candidate.project_id === ticket.project_id,
    )
    return related ? `#${related.number} — ${heading(related.title)}` : 'Ticket indisponible'
  }
  return [
    `# ${ticket.number ? `Ticket #${ticket.number} — ` : ''}${heading(ticket.title)}`,
    '',
    `Projet : ${heading(projectName)}`,
    `Statut : ${statuses.find((status) => status.id === ticket.status)?.label || ticket.status}`,
    `Priorité : ${priorities[ticket.priority]}`,
    `Difficulté : ${difficulties[ticket.difficulty]}`,
    ...(ticket.parent_id ? [`Parent : ${ref(ticket.parent_id)}`] : []),
    ...(prerequisiteIds(ticket).length
      ? ['Prérequis :', ...prerequisiteIds(ticket).map((id) => `- ${ref(id)}`)]
      : []),
    '',
    ticket.description,
  ].join('\n')
}
