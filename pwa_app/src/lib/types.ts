export type VoterStatus =
  | 'Supporter'
  | 'Leaning'
  | 'Undecided'
  | 'Opposition'
  | 'Hostile'
  | 'Unsurveyed';

export type GenderFilter = 'all' | 'male' | 'female';

export type DashboardStatusFilter = 'all' | VoterStatus;

export interface QuickFilters {
  youth: boolean;
  studentTeacher: boolean;
  male: boolean;
  female: boolean;
}

export interface SearchFilters {
  query: string;
  dashboardStatus: DashboardStatusFilter;
  quickFilters: QuickFilters;
}

export interface VoterRecord {
  id: number;
  block_code: string;
  serial_no: string;
  name: string;
  father_husband_name: string;
  cnic: string;
  profession: string;
  age: number | null;
  address: string;
  inferred_family_id: string;
  voter_status: VoterStatus;
  is_on_duty: number | boolean;
}

export interface FamilySummary {
  inferred_family_id: string;
  block_code: string;
  address: string;
  total_votes: number;
  supporters: number;
  leaning: number;
  undecided: number;
  opposition: number;
  hostile: number;
  unsurveyed: number;
}

export interface DutyStaffSourceRow {
  [key: string]: string | number | boolean | null | undefined;
  cnic?: string;
  name?: string;
  father_husband_name?: string;
}

export interface DutyStaffMatchResult {
  sourceIndex: number;
  sourceRow: DutyStaffSourceRow;
  voterId?: number;
  voterName?: string;
  stage: 'cnic' | 'name-father' | 'levenshtein' | 'unmatched';
  matched: boolean;
}
