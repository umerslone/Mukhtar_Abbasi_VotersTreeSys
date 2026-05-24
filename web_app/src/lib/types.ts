export type VoterStatus = 'Supporter' | 'Non-Supporter' | 'Undecided' | 'Unsurveyed';

export interface VoterRow {
  id: string;
  block_code: string;
  serial_no: string;
  name: string;
  father_husband_name: string;
  cnic: string;
  profession: string;
  age: number | null;
  address: string;
  inferred_family_id: string;
  gender: string | null;
  voter_status: string;
  is_on_duty: boolean;
}

export interface FamilyGroup {
  inferred_family_id: string;
  block_code: string;
  address: string;
  members: VoterRow[];
}
