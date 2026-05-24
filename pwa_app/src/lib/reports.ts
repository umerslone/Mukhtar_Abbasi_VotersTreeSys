import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { FamilySummary, VoterRecord } from './types';
import type { OfflineVoterDatabase } from './offline-db';

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvSafe(value: string | number | boolean | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export async function exportPollingStationWalkList(db: OfflineVoterDatabase): Promise<void> {
  const voters = await db.searchVoters({ query: '', dashboardStatus: 'all', quickFilters: { youth: false, studentTeacher: false, male: false, female: false } }, 70000);
  const workbook = XLSX.utils.book_new();
  const grouped = new Map<string, VoterRecord[]>();

  for (const voter of voters) {
    const key = `${voter.block_code} :: ${voter.address}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(voter);
  }

  const rows: Array<Record<string, string | number>> = [];
  for (const [groupKey, group] of grouped.entries()) {
    for (const voter of group) {
      rows.push({
        Address: groupKey,
        Serial: voter.serial_no,
        Name: voter.name,
        CNIC: voter.cnic,
        Status: voter.voter_status,
        Checked: ''
      });
    }
    rows.push({ Address: groupKey, Serial: '', Name: '', CNIC: '', Status: '', Checked: '' });
  }

  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Walk List');
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'polling-station-walk-list.xlsx');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Polling Station Walk-List', 36, 36);
  doc.setFontSize(8);
  let y = 60;
  for (const [groupKey, group] of grouped.entries()) {
    if (y > 520) {
      doc.addPage();
      y = 36;
    }
    doc.text(`${groupKey}  |  ${group.length} voters`, 36, y);
    y += 12;
    for (const voter of group.slice(0, 25)) {
      doc.text(`[ ] ${csvSafe(voter.serial_no)} - ${csvSafe(voter.name)} - ${csvSafe(voter.cnic)}`, 48, y);
      y += 10;
      if (y > 520) {
        doc.addPage();
        y = 36;
      }
    }
    y += 6;
  }
  doc.save('polling-station-walk-list.pdf');
}

export async function exportUndecidedTargets(db: OfflineVoterDatabase): Promise<void> {
  const voters = await db.getUndecidedTargets();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    voters.map((voter) => ({
      Block: voter.block_code,
      Address: voter.address,
      Serial: voter.serial_no,
      Name: voter.name,
      FatherHusbandName: voter.father_husband_name,
      CNIC: voter.cnic,
      Profession: voter.profession,
      Age: voter.age,
      Status: voter.voter_status
    }))
  );
  XLSX.utils.book_append_sheet(workbook, sheet, 'Undecided Targets');
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'undecided-targets.xlsx');
}

export async function exportDutyStaffTargets(db: OfflineVoterDatabase): Promise<void> {
  const voters = await db.getDutyStaffTargets();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    voters.map((voter) => ({
      Block: voter.block_code,
      Address: voter.address,
      Serial: voter.serial_no,
      Name: voter.name,
      FatherHusbandName: voter.father_husband_name,
      CNIC: voter.cnic,
      Profession: voter.profession,
      Age: voter.age,
      Status: voter.voter_status,
      Duty: 'YES'
    }))
  );
  XLSX.utils.book_append_sheet(workbook, sheet, 'Duty Staff');
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'duty-staff-postal-targets.xlsx');
}

export async function exportFamilyInfluenceReport(db: OfflineVoterDatabase): Promise<void> {
  const rows = await db.getFamilyInfluenceRows();
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      FamilyId: row.inferred_family_id,
      Block: row.block_code,
      Address: row.address,
      HeadOfHousehold: row.head_name,
      TotalVotes: row.total_votes,
      Supporters: row.supporters,
      Leaning: row.leaning,
      Undecided: row.undecided,
      Opposition: row.opposition,
      Hostile: row.hostile,
      Unsurveyed: row.unsurveyed
    }))
  );
  XLSX.utils.book_append_sheet(workbook, sheet, 'Family Influence');
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'family-influence-report.xlsx');
}

export async function exportAllReports(db: OfflineVoterDatabase): Promise<void> {
  await exportPollingStationWalkList(db);
  await exportUndecidedTargets(db);
  await exportDutyStaffTargets(db);
  await exportFamilyInfluenceReport(db);
}
