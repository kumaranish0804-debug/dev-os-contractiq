// Standard key terms per contract type (Spec 06 §6.2). Pure module: zero imports.

export type ContractType = 'NDA' | 'MSA';

export interface TermDef {
  key: string;
  name: string;
  /** Extraction hint sent to the model. */
  description: string;
  /** Plain-English tooltip shown in the UI. */
  glossary: string;
}

export const TERM_LIBRARY: Record<ContractType, TermDef[]> = {
  NDA: [
    {
      key: 'parties',
      name: 'Parties',
      description: 'Legal names of all parties and their roles (disclosing / receiving / mutual)',
      glossary: 'Who is signing and which side shares or receives information',
    },
    {
      key: 'effective_date',
      name: 'Effective Date',
      description: 'Date the agreement takes effect',
      glossary: 'When the agreement starts applying',
    },
    {
      key: 'confidentiality_obligations',
      name: 'Confidentiality Obligations',
      description:
        'What the receiving party must do or not do with confidential information, including the standard of care',
      glossary: "What you must do to keep the other side's information secret",
    },
    {
      key: 'permitted_disclosures',
      name: 'Permitted Disclosures',
      description:
        'Who confidential information may be shared with, and exceptions (e.g. legal compulsion, already public)',
      glossary: "When you're allowed to share the information",
    },
    {
      key: 'term_and_duration',
      name: 'Term & Duration',
      description:
        'Length of the agreement and how long confidentiality obligations survive after it ends',
      glossary: 'How long the agreement and the secrecy duty last',
    },
    {
      key: 'governing_law',
      name: 'Governing Law',
      description: 'Jurisdiction whose laws govern the agreement',
      glossary: "Which country's or state's laws apply",
    },
    {
      key: 'jurisdiction',
      name: 'Jurisdiction',
      description: 'Courts or forum for disputes',
      glossary: 'Where a dispute would be heard',
    },
    {
      key: 'ip_ownership',
      name: 'IP Ownership',
      description:
        'Who owns intellectual property in, or derived from, the disclosed information; any licence grant or its absence',
      glossary: 'Who owns ideas, inventions or materials shared',
    },
    {
      key: 'non_solicitation',
      name: 'Non-Solicitation',
      description:
        "Restrictions on soliciting or hiring the other party's employees or customers, with the duration",
      glossary: 'Whether you can hire their staff or approach their clients',
    },
    {
      key: 'breach_and_remedy',
      name: 'Breach & Remedy',
      description:
        'Consequences of breach: injunctive relief, damages, indemnity, return/destruction of information',
      glossary: 'What happens if someone breaks the agreement',
    },
  ],
  MSA: [
    {
      key: 'parties',
      name: 'Parties',
      description: 'Legal names of the customer and provider',
      glossary: 'Who is signing',
    },
    {
      key: 'service_scope',
      name: 'Service Scope',
      description: 'Services to be provided and where they are defined (SOWs, schedules)',
      glossary: 'What work is being provided',
    },
    {
      key: 'payment_terms',
      name: 'Payment Terms',
      description: 'Fees, pricing basis and the payment due period (e.g. net 30)',
      glossary: 'How much and how fast you pay',
    },
    {
      key: 'invoice_schedule',
      name: 'Invoice Schedule',
      description:
        'When and how invoices are issued (monthly, milestone, in advance or in arrears)',
      glossary: 'When bills are sent',
    },
    {
      key: 'late_payment_penalty',
      name: 'Late Payment Penalty',
      description: 'Interest, fees or suspension rights for late payment',
      glossary: 'What happens if payment is late',
    },
    {
      key: 'liability_cap',
      name: 'Liability Cap',
      description:
        'Maximum aggregate liability, the cap amount or formula, and exclusions (e.g. indirect damages)',
      glossary: 'The most either side can be made to pay',
    },
    {
      key: 'indemnification',
      name: 'Indemnification',
      description: 'Who indemnifies whom, for what claims, and the procedure',
      glossary: 'Who pays if a third party sues',
    },
    {
      key: 'ip_ownership',
      name: 'IP Ownership',
      description: 'Ownership of deliverables, pre-existing IP and licences granted',
      glossary: 'Who owns the work produced',
    },
    {
      key: 'termination_clause',
      name: 'Termination Clause',
      description: 'Rights to terminate for convenience or cause, and the effects of termination',
      glossary: 'How and when the contract can be ended',
    },
    {
      key: 'governing_law',
      name: 'Governing Law',
      description: 'Jurisdiction whose laws govern the agreement',
      glossary: 'Which laws apply',
    },
    {
      key: 'dispute_resolution',
      name: 'Dispute Resolution',
      description: 'Escalation, mediation, arbitration or courts, and the venue',
      glossary: 'How disagreements get resolved',
    },
    {
      key: 'notice_period',
      name: 'Notice Period',
      description:
        'Required notice periods (termination, renewal, changes) and how notice must be given',
      glossary: 'How much warning must be given',
    },
  ],
};

export const getStandardTerms = (type: ContractType): TermDef[] => TERM_LIBRARY[type];

export function toCustomTermKey(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `custom_${slug}`;
}

export function customTermDef(name: string): TermDef {
  const trimmed = name.trim();
  return {
    key: toCustomTermKey(trimmed),
    name: trimmed,
    description: `User-requested term: ${trimmed}. Extract the clause or value in this contract that answers it.`,
    glossary: 'Custom term you added',
  };
}

/** Case- and whitespace-insensitive comparison key for term names. */
export const termNameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** True when `name` matches a standard term of `type` (custom terms may not duplicate them). */
export function isStandardTermName(type: ContractType, name: string): boolean {
  const key = termNameKey(name);
  return TERM_LIBRARY[type].some((t) => termNameKey(t.name) === key);
}
