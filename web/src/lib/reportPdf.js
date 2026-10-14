import { jsPDF } from 'jspdf';
import { formatCompactPlanKg, formatDate, formatKg, formatMil, formatPlanWaterfallTick } from './format.js';

// PDF montado diretamente com texto, retângulos e linhas (vetor). Nada é capturado da tela.
const MARGIN = 15;
const PAGE_WIDTH = 210;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;
const CONTENT_WIDTH = RIGHT_EDGE - MARGIN;
const CONTENT_BOTTOM = 268;
const FOOTER_Y = 284;
const PT_TO_MM = 0.3528;
const LINE_SPACING = 1.35;
const TABLE_TEXT_SIZE = 8;

const COLOR = {
  red: [226, 6, 19],
  ink: [56, 66, 75],
  muted: [120, 127, 133],
  body: [60, 70, 78],
  line: [216, 221, 225],
  softLine: [230, 233, 235],
  grid: [200, 206, 211],
  panel: [247, 248, 249],
  zebra: [242, 244, 245],
  white: [255, 255, 255]
};

function lineHeight(size) {
  return size * PT_TO_MM * LINE_SPACING;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatGeneratedAt(date) {
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function niceStep(rawStep) {
  const base = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

function createReportWriter({ title, runningTitle, footerTitle }) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title, author: 'US Vale Verde', creator: 'Dashboard de Emulsão' });
  pdf.setDrawColor(...COLOR.line);
  const page = { y: MARGIN };

  const applyStyle = (size, bold, color) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };

  const write = (value, x, y, { size = 9, bold = false, color = COLOR.ink, align = 'left', spacing = 0, angle = 0 } = {}) => {
    applyStyle(size, bold, color);
    pdf.setCharSpace(spacing);
    pdf.text(String(value), x, y, { align, angle });
    pdf.setCharSpace(0);
  };

  const splitLines = (value, width, { size = 9, bold = false } = {}) => {
    applyStyle(size, bold, COLOR.ink);
    return pdf.splitTextToSize(String(value), width);
  };

  const textWidth = (value, size, bold = false) => {
    applyStyle(size, bold, COLOR.ink);
    return pdf.getTextWidth(String(value));
  };

  // Corta o texto com reticências para caber na largura dada (uma linha só).
  const fitText = (value, maxWidth, { size = 9, bold = false } = {}) => {
    let text = String(value);
    if (textWidth(text, size, bold) <= maxWidth) return text;
    while (text.length > 1 && textWidth(`${text}...`, size, bold) > maxWidth) text = text.slice(0, -1);
    return `${text}...`;
  };

  const writeLines = (lines, x, y, { size = 9, bold = false, color = COLOR.ink, align = 'left' } = {}) => {
    lines.forEach((line, index) => write(line, x, y + index * lineHeight(size), { size, bold, color, align }));
    return lines.length * lineHeight(size);
  };

  const rule = (x1, y1, x2, y2, { color = COLOR.line, width = 0.25 } = {}) => {
    pdf.setDrawColor(...color);
    pdf.setLineWidth(width);
    pdf.line(x1, y1, x2, y2);
  };

  const dashed = (x1, y1, x2, y2) => {
    pdf.setDrawColor(...COLOR.grid);
    pdf.setLineWidth(0.2);
    pdf.setLineDashPattern([0.9, 0.9], 0);
    pdf.line(x1, y1, x2, y2);
    pdf.setLineDashPattern([], 0);
  };

  const box = (x, y, width, height, { fill = null, stroke = null, radius = 0 } = {}) => {
    if (fill) pdf.setFillColor(...fill);
    if (stroke) pdf.setDrawColor(...stroke);
    const mode = fill && stroke ? 'FD' : fill ? 'F' : 'S';
    if (radius) pdf.roundedRect(x, y, width, height, radius, radius, mode);
    else pdf.rect(x, y, width, height, mode);
  };

  const newPage = () => {
    pdf.addPage();
    write(fitText(runningTitle, CONTENT_WIDTH, { size: 7.5 }), MARGIN, MARGIN + 2, { size: 7.5, color: COLOR.muted });
    rule(MARGIN, MARGIN + 5, RIGHT_EDGE, MARGIN + 5);
    page.y = MARGIN + 11;
  };

  // Abre página nova quando `height` não cabe; devolve true nesse caso.
  const ensure = (height) => {
    if (page.y + height <= CONTENT_BOTTOM) return false;
    newPage();
    return true;
  };

  const finish = () => {
    const total = pdf.getNumberOfPages();
    for (let number = 1; number <= total; number += 1) {
      pdf.setPage(number);
      rule(MARGIN, FOOTER_Y - 3, RIGHT_EDGE, FOOTER_Y - 3, { width: 0.2 });
      const pageLabel = `Página ${number} de ${total}`;
      const pageLabelWidth = textWidth(pageLabel, 7);
      write(fitText(footerTitle, CONTENT_WIDTH - pageLabelWidth - 6, { size: 7 }), MARGIN, FOOTER_Y, { size: 7, color: COLOR.muted });
      write(pageLabel, RIGHT_EDGE, FOOTER_Y, { size: 7, color: COLOR.muted, align: 'right' });
    }
    return pdf;
  };

  return { pdf, page, write, splitLines, writeLines, textWidth, rule, dashed, box, ensure, finish };
}

function drawMasthead(writer, { kicker, title, subtitle }) {
  const { page, write, rule, splitLines, writeLines, textWidth } = writer;
  write('US VALE VERDE', MARGIN, page.y + 3, { size: 8, color: COLOR.ink, spacing: 0.2 });
  rule(MARGIN, page.y + 6.5, RIGHT_EDGE, page.y + 6.5, { color: COLOR.red, width: 0.9 });
  page.y += 13;
  write(kicker, MARGIN, page.y + 2.5, { size: 7.5, bold: true, color: COLOR.red, spacing: 0.25 });
  page.y += 6;
  // Nome longo: diminui a fonte até caber em no máximo duas linhas, sem estourar a margem.
  let titleFit = null;
  for (const size of [20, 16, 13, 11]) {
    const lines = splitLines(title, CONTENT_WIDTH, { size, bold: true });
    if (lines.length <= 2 && lines.every((line) => textWidth(line, size, true) <= CONTENT_WIDTH)) {
      titleFit = { size, lines };
      break;
    }
  }
  if (!titleFit) titleFit = { size: 11, lines: splitLines(title, CONTENT_WIDTH, { size: 11, bold: true }).slice(0, 2) };
  page.y += writeLines(titleFit.lines, MARGIN, page.y + 6, { size: titleFit.size, bold: true }) + 1.5;
  write(subtitle, MARGIN, page.y + 3, { size: 10, color: COLOR.muted });
  page.y += 10;
}

function drawKpiPanel(writer, items) {
  const { page, box, rule, splitLines, writeLines, write, ensure } = writer;
  const height = 22;
  ensure(height);
  box(MARGIN, page.y, CONTENT_WIDTH, height, { stroke: COLOR.line, radius: 2 });
  const cellWidth = CONTENT_WIDTH / items.length;
  items.forEach((item, index) => {
    const x = MARGIN + index * cellWidth;
    if (index > 0) rule(x, page.y + 3, x, page.y + height - 3, { color: COLOR.softLine, width: 0.2 });
    write(item.label, x + 4, page.y + 6.5, { size: 7, color: COLOR.muted });
    const lines = splitLines(item.value, cellWidth - 8, { size: item.size, bold: true });
    writeLines(lines, x + 4, page.y + 13.5, { size: item.size, bold: true, color: item.red ? COLOR.red : COLOR.ink });
  });
  page.y += height + 4;
}

function drawSectionHeader(writer, kicker, aside = '') {
  const { page, write, rule, ensure } = writer;
  ensure(9);
  rule(MARGIN, page.y, RIGHT_EDGE, page.y);
  write(kicker, MARGIN, page.y + 5, { size: 7.5, bold: true, color: COLOR.red, spacing: 0.25 });
  if (aside) write(aside, RIGHT_EDGE, page.y + 5, { size: 7, color: COLOR.muted, align: 'right' });
  page.y += 9;
}

// Tabela que quebra entre linhas e repete o cabeçalho em cada página nova.
// Com `section`, o título da seção nunca fica sozinho no fim de uma página.
function drawTable(writer, { section = null, columns, rows, total = null, emptyText = '' }) {
  const { page, write, rule, box, ensure, splitLines, writeLines } = writer;

  const drawHeader = () => {
    columns.forEach((column) => write(column.label, column.x, page.y + 4.6, { size: TABLE_TEXT_SIZE, bold: true, align: column.align }));
    rule(MARGIN, page.y + 7, RIGHT_EDGE, page.y + 7, { color: COLOR.red, width: 0.4 });
    page.y += 8.5;
  };

  const measure = (row) => columns.map((column) => splitLines(row[column.key] ?? '', column.wrapWidth, { size: TABLE_TEXT_SIZE, bold: column.bold }));
  const heightOf = (cells) => Math.max(1, ...cells.map((lines) => lines.length)) * lineHeight(TABLE_TEXT_SIZE) + 3.4;

  const firstRowHeight = rows.length ? heightOf(measure(rows[0])) : 9;
  if (section) {
    ensure(9 + 8.5 + firstRowHeight);
    drawSectionHeader(writer, section.kicker, section.aside);
  } else {
    ensure(8.5 + firstRowHeight);
  }
  drawHeader();

  if (!rows.length) {
    write(emptyText, MARGIN + 3, page.y + 4.5, { size: TABLE_TEXT_SIZE, color: COLOR.muted });
    page.y += 9;
  }

  rows.forEach((row, index) => {
    const cells = measure(row);
    const height = heightOf(cells);
    if (ensure(height)) drawHeader();
    if (index % 2 === 1) box(MARGIN, page.y, CONTENT_WIDTH, height, { fill: COLOR.zebra });
    columns.forEach((column, columnIndex) => {
      writeLines(cells[columnIndex], column.x, page.y + 4.2, { size: TABLE_TEXT_SIZE, bold: column.bold, align: column.align });
    });
    page.y += height;
    rule(MARGIN, page.y, RIGHT_EDGE, page.y, { color: COLOR.softLine, width: 0.2 });
  });

  if (total) {
    const cells = measure(total);
    const height = heightOf(cells);
    if (ensure(height)) drawHeader();
    rule(MARGIN, page.y, RIGHT_EDGE, page.y, { color: COLOR.red, width: 0.4 });
    columns.forEach((column, columnIndex) => {
      writeLines(cells[columnIndex], column.x, page.y + 4.6, { size: TABLE_TEXT_SIZE, bold: true, align: column.align });
    });
    page.y += height + 2;
  }
  page.y += 4;
}

function drawWaterfallChart(writer, rows) {
  const { page, write, rule, dashed, box, ensure } = writer;
  const cardHeight = 92;
  ensure(9 + cardHeight);
  drawSectionHeader(writer, 'GRÁFICO DE CASCATA', 'Emulsão acima da barra · furos no centro');

  const top = page.y;
  box(MARGIN, top, CONTENT_WIDTH, cardHeight, { stroke: COLOR.line, fill: COLOR.white });
  write('Emulsão aplicada (kg)', MARGIN + 4, top + 7, { size: 9.5, bold: true });
  write('Valores em milhares de kg', RIGHT_EDGE - 4, top + 7, { size: 7, color: COLOR.muted, align: 'right' });

  const plotLeft = MARGIN + 18;
  const plotRight = RIGHT_EDGE - 6;
  const plotTop = top + 18;
  const plotBottom = top + cardHeight - 12;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = plotRight - plotLeft;
  // Folga acima da maior barra para o rótulo de valor não encostar no título do cartão.
  const peak = Math.max(1, ...rows.map((row) => row.base + row.value)) * 1.12;
  const step = niceStep(peak / 4);
  const max = step * Math.ceil(peak / step);
  const yOf = (value) => plotBottom - (value / max) * plotHeight;

  const tickCount = Math.round(max / step);
  for (let index = 0; index <= tickCount; index += 1) {
    const tick = index * step;
    const y = yOf(tick);
    if (index > 0) dashed(plotLeft, y, plotRight, y);
    write(formatMil(tick), plotLeft - 2.5, y + 1.2, { size: 6, color: COLOR.muted, align: 'right' });
  }
  rule(plotLeft, plotBottom, plotRight, plotBottom, { color: COLOR.grid, width: 0.25 });

  // Com muitos dias (barras estreitas), o valor sai na vertical e o eixo X mostra um rótulo a cada k dias.
  const slot = plotWidth / rows.length;
  const dense = slot < 9;
  const barWidth = Math.min(slot * 0.6, 16);
  const labelSize = dense ? 5 : 6.5;
  const labelEvery = dense ? Math.ceil(7 / slot) : 1;
  rows.forEach((row, index) => {
    const centerX = plotLeft + slot * (index + 0.5);
    const barTop = yOf(row.base + row.value);
    const barHeight = Math.max(yOf(row.base) - barTop, 0.3);
    box(centerX - barWidth / 2, barTop, barWidth, barHeight, { fill: row.isTotal ? COLOR.ink : COLOR.red });

    if (dense) {
      write(formatCompactPlanKg(row.value), centerX + 0.6, barTop - 1.5, { size: labelSize, bold: true, angle: 90 });
    } else {
      write(formatCompactPlanKg(row.value), centerX, barTop - 1.8, { size: labelSize, bold: true, align: 'center' });
      write(Number(row.furos).toLocaleString('pt-BR'), centerX, barTop + barHeight / 2 + 1, {
        size: labelSize,
        bold: true,
        color: barHeight >= 3.5 ? COLOR.white : COLOR.ink,
        align: 'center'
      });
    }

    if (row.isTotal || index % labelEvery === 0) {
      write(formatPlanWaterfallTick(row.label), centerX, plotBottom + 4.5, { size: labelSize, color: COLOR.muted, align: 'center' });
    }
  });

  page.y = top + cardHeight + 4;
}

export function createDailyReportPdf({ selectedDate, monthStart, monthTotal, dayTotal, dayByPolygon, dayJustifications, generatedAt = new Date() }) {
  const reportDate = formatDate(selectedDate);
  const writer = createReportWriter({
    title: `Relatório de Aplicação Diária ${reportDate}`,
    runningTitle: `US VALE VERDE · Aplicação de Emulsão · ${reportDate}`,
    footerTitle: `Relatório de Aplicação Diária · gerado em ${formatGeneratedAt(generatedAt)}`
  });
  const { page, write, rule, box, splitLines, writeLines, ensure } = writer;
  const monthLabel = capitalize(new Date(`${selectedDate}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));

  drawMasthead(writer, { kicker: 'RESUMO OPERACIONAL', title: 'Aplicação de Emulsão', subtitle: monthLabel });

  drawKpiPanel(writer, [
    { label: 'Data de referência', value: reportDate, size: 12 },
    { label: 'Aplicado (Month to date)', value: formatKg(monthTotal.emulsao), size: 12, red: true },
    { label: 'Aplicado/Dia', value: formatKg(dayTotal.emulsao), size: 12 },
    { label: 'Furos Carregados/Dia', value: dayTotal.furos.toLocaleString('pt-BR'), size: 12 }
  ]);

  ensure(16);
  drawSectionHeader(writer, 'ACUMULADO MENSAL', `De ${formatDate(monthStart)} até ${reportDate}`);
  write(`${monthTotal.registros.toLocaleString('pt-BR')} registros`, MARGIN, page.y + 4, { size: 12, bold: true });
  page.y += 12;

  drawTable(writer, {
    section: {
      kicker: 'APLICAÇÃO DETALHADA/DIA',
      aside: `${dayByPolygon.length.toLocaleString('pt-BR')} ${dayByPolygon.length === 1 ? 'plano' : 'planos'}`
    },
    columns: [
      { key: 'plano', label: 'Plano', x: MARGIN + 3, align: 'left', wrapWidth: 110 },
      { key: 'emulsao', label: 'Emulsão', x: RIGHT_EDGE - 22, align: 'right', wrapWidth: 40, bold: true },
      { key: 'furos', label: 'Furos', x: RIGHT_EDGE - 3, align: 'right', wrapWidth: 30, bold: true }
    ],
    rows: dayByPolygon.map((row) => ({
      plano: row.poligono || 'Sem plano',
      emulsao: formatKg(row.emulsao),
      furos: row.furos.toLocaleString('pt-BR')
    })),
    emptyText: 'Nenhuma aplicação encontrada nesta data.'
  });

  const justificationBoxes = dayJustifications.map((item) => ({
    item,
    lines: splitLines(item.motivo, CONTENT_WIDTH - 10, { size: 8.5 })
  }));
  const boxHeight = (lines) => 6 + lines.length * lineHeight(8.5) + 2.5;
  ensure(9 + (justificationBoxes.length ? boxHeight(justificationBoxes[0].lines) : 8));
  drawSectionHeader(writer, 'JUSTIFICATIVAS DA DATA');
  if (!justificationBoxes.length) {
    write('Nenhuma justificativa registrada para esta data.', MARGIN, page.y + 3, { size: 8.5, color: COLOR.muted });
    page.y += 8;
  }
  justificationBoxes.forEach(({ item, lines }) => {
    const height = boxHeight(lines);
    ensure(height + 2);
    box(MARGIN, page.y, CONTENT_WIDTH, height, { fill: COLOR.panel });
    box(MARGIN, page.y, 1.1, height, { fill: COLOR.red });
    write(`${formatDate(item.data)} · ${item.poligono || 'Geral'}`, MARGIN + 4.5, page.y + 4.5, { size: 8, bold: true });
    writeLines(lines, MARGIN + 4.5, page.y + 9, { size: 8.5, color: COLOR.body });
    page.y += height + 2.5;
  });

  return writer.finish();
}

export function createPlanReportPdf({ plan, dailyRows, planTotal, firstDate, lastDate, waterfallRows, generatedAt = new Date() }) {
  const writer = createReportWriter({
    title: `Relatório de Aplicação por Plano ${plan}`,
    runningTitle: `US VALE VERDE · Aplicação por Plano · ${plan}`,
    footerTitle: `Relatório de Aplicação por Plano · ${plan} · gerado em ${formatGeneratedAt(generatedAt)}`
  });

  drawMasthead(writer, {
    kicker: 'CONSOLIDAÇÃO OPERACIONAL',
    title: plan,
    subtitle: 'Relatório de Aplicação por Plano · dias de carregamento'
  });
  drawKpiPanel(writer, [
    { label: 'Período do plano', value: `${formatDate(firstDate)} — ${formatDate(lastDate)}`, size: 10 },
    { label: 'Emulsão aplicada', value: formatKg(planTotal.emulsao), size: 12, red: true },
    { label: 'Furos carregados', value: planTotal.furos.toLocaleString('pt-BR'), size: 12 },
    { label: 'Dias de carregamento', value: dailyRows.length.toLocaleString('pt-BR'), size: 12 }
  ]);

  drawTable(writer, {
    section: {
      kicker: 'APLICAÇÃO POR DIA DE CARREGAMENTO',
      aside: `${dailyRows.length.toLocaleString('pt-BR')} dias consolidados`
    },
    columns: [
      { key: 'dia', label: 'Dia de carregamento', x: MARGIN + 3, align: 'left', wrapWidth: 90 },
      { key: 'furos', label: 'Furos carregados', x: MARGIN + 118, align: 'right', wrapWidth: 60 },
      { key: 'emulsao', label: 'Emulsão aplicada', x: RIGHT_EDGE - 3, align: 'right', wrapWidth: 60 }
    ],
    rows: dailyRows.map((row) => ({
      dia: row.dia,
      furos: row.furos.toLocaleString('pt-BR'),
      emulsao: formatKg(row.emulsao)
    })),
    total: {
      dia: 'Total',
      furos: planTotal.furos.toLocaleString('pt-BR'),
      emulsao: formatKg(planTotal.emulsao)
    }
  });

  drawWaterfallChart(writer, waterfallRows);

  return writer.finish();
}
