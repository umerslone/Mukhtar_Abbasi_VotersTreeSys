'use client';

import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { VoterRow } from '@/lib/types';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function wardListPdf(rows: VoterRow[]): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Ward List', 36, 36);
  doc.setFontSize(9);
  let y = 60;
  let lastAddress = '';
  for (const row of rows) {
    if (row.address !== lastAddress) {
      if (y > 760) {
        doc.addPage();
        y = 36;
      }
      doc.setFont('helvetica', 'bold');
      doc.text(row.address, 36, y);
      y += 14;
      lastAddress = row.address;
    }
    doc.setFont('helvetica', 'normal');
    const line = `${row.serial_no}  ${row.name}  -  ${row.cnic}  [${row.voter_status}]`;
    doc.text(line, 48, y);
    y += 12;
    if (y > 780) {
      doc.addPage();
      y = 36;
    }
  }
  doc.save('ward-list.pdf');
}

function dutyStaffPdf(rows: VoterRow[]): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Duty Staff Voters', 36, 36);
  doc.setFontSize(9);
  let y = 60;
  for (const row of rows) {
    const line = `${row.serial_no}  ${row.name}  -  ${row.cnic}  -  ${row.address}`;
    doc.text(line, 36, y);
    y += 12;
    if (y > 780) {
      doc.addPage();
      y = 36;
    }
  }
  doc.save('duty-staff.pdf');
}

function wardListXlsx(rows: VoterRow[]): void {
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      Block: row.block_code,
      Address: row.address,
      Serial: row.serial_no,
      Name: row.name,
      CNIC: row.cnic,
      Status: row.voter_status,
      OnDuty: row.is_on_duty ? 'YES' : ''
    }))
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Ward List');
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'ward-list.xlsx');
}

export function ExportsPanel({ wardList, dutyStaff }: Readonly<{ wardList: VoterRow[]; dutyStaff: VoterRow[] }>) {
  return (
    <section className="panel grid gap-3 p-5 md:grid-cols-2">
      <button
        type="button"
        onClick={() => wardListPdf(wardList)}
        className="rounded-2xl bg-slate-900 px-4 py-4 text-left text-white"
      >
        <div className="text-sm font-bold">Export Ward List (PDF)</div>
        <div className="text-xs text-white/70">Sorted by address, with current voter_status.</div>
      </button>
      <button
        type="button"
        onClick={() => wardListXlsx(wardList)}
        className="rounded-2xl bg-emerald-600 px-4 py-4 text-left text-white"
      >
        <div className="text-sm font-bold">Export Ward List (XLSX)</div>
        <div className="text-xs text-white/70">SheetJS workbook for offline review.</div>
      </button>
      <button
        type="button"
        onClick={() => dutyStaffPdf(dutyStaff)}
        className="rounded-2xl bg-violet-600 px-4 py-4 text-left text-white md:col-span-2"
      >
        <div className="text-sm font-bold">Export Duty Staff (PDF)</div>
        <div className="text-xs text-white/70">All voters where is_on_duty is true.</div>
      </button>
    </section>
  );
}
