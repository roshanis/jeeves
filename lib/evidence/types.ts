export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_INITIATIVE_BYTES = 20 * 1024 * 1024;
export type EvidenceEntry = { controlId: string; documentId: string; pageReference: string; note: string };
export type EvidenceAssessment = { id: string; packetId: string; controlId: string; decision: 'accepted' | 'changes_requested'; reason: string; reviewer: string; reviewedAt: string; inherited: boolean };
export type EvidenceDocument = { id: string; fileName: string; mediaType: string; byteSize: number; sha256: string; scanStatus: 'not_scanned'; version: number; supersedesId: string | null; uploadedBy: string; createdAt: string };
export type EvidencePacket = { id: string; cycleId: string; version: number; revision: number; status: 'draft' | 'submitted'; entries: EvidenceEntry[]; submittedAt: string | null };
export type EvidenceRequirement = { id: string; name: string; domain: string; description: string; policySource: string | null; status: 'missing' | 'submitted' | 'accepted' | 'changes_requested'; entry: EvidenceEntry | null; assessment: EvidenceAssessment | null; signed: boolean };
export type EvidenceState = { initiativeId: string; cycleId: string | null; canEdit: boolean; reviewerDomain: string | null; documents: EvidenceDocument[]; requirements: EvidenceRequirement[]; draft: EvidencePacket | null; latest: EvidencePacket | null; history: (EvidencePacket & { assessments: EvidenceAssessment[] })[]; usedBytes: number };
