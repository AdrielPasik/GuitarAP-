import { toCanvas } from 'html-to-image';
import type { ExportSettings } from '@/features/export/export-plan';

const SVG_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'display',
];

/**
 * Browsers rasterize an SVG that is drawn as an image without the page's CSS variables, which is how the
 * v0.2 export produced a black neck. Here every drawing is turned into a self-contained image first, with
 * the colors it actually has resolved from the themed sheet.
 */
function freezeSvg(svg: SVGSVGElement) {
  const box = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const live = [svg, ...svg.querySelectorAll('*')];
  const copy = [clone, ...clone.querySelectorAll('*')];
  live.forEach((element, index) => {
    const style = getComputedStyle(element);
    const target = copy[index] as SVGElement;
    target.removeAttribute('class');
    const css = SVG_PROPS.map((prop) => `${prop}:${style.getPropertyValue(prop)}`).join(';');
    target.setAttribute('style', css);
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(box.width));
  clone.setAttribute('height', String(box.height));
  const image = document.createElement('img');
  image.width = box.width;
  image.height = box.height;
  image.style.display = 'block';
  image.style.width = `${box.width}px`;
  image.style.height = `${box.height}px`;
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  return image;
}

export type RenderedSheet = {
  canvas: HTMLCanvasElement;
  /** Layout rectangles (CSS px, relative to the sheet) of what a PDF page must not cut through. */
  units: Array<{ top: number; bottom: number }>;
  width: number;
  height: number;
  background: string;
};

/** Draws an independent copy of the sheet off-screen so the person's screen is never touched. */
export async function renderSheet(source: HTMLElement, settings: ExportSettings, ratio: number): Promise<RenderedSheet> {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    await document.fonts?.ready;
    const svgs = [...clone.querySelectorAll('svg.fb-svg')] as SVGSVGElement[];
    const frozen = svgs.map((svg) => freezeSvg(svg));
    await Promise.all(frozen.map((image) => image.decode().catch(() => undefined)));
    svgs.forEach((svg, index) => svg.replaceWith(frozen[index]));
    const rect = clone.getBoundingClientRect();
    const units = [...clone.querySelectorAll('[data-export-unit]')].map((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top - rect.top, bottom: box.bottom - rect.top };
    });
    const background = getComputedStyle(clone).backgroundColor;
    const transparent = settings.background === 'transparent' && settings.format === 'png';
    const canvas = await toCanvas(clone, {
      pixelRatio: ratio,
      cacheBust: true,
      backgroundColor: transparent ? undefined : background === 'rgba(0, 0, 0, 0)' ? '#ffffff' : background,
    });
    return { canvas, units, width: rect.width, height: rect.height, background };
  } finally {
    holder.remove();
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen.'))), 'image/png'));

export async function exportPng(source: HTMLElement, settings: ExportSettings, name: string) {
  const sheet = await renderSheet(source, settings, settings.quality);
  download(await canvasBlob(sheet.canvas), name);
  return { width: sheet.canvas.width, height: sheet.canvas.height };
}

export type PdfPage = { top: number; bottom: number };

/** Groups units into pages without ever splitting one, scaling down only a unit taller than a page. */
export function paginate(units: Array<{ top: number; bottom: number }>, maxHeight: number): PdfPage[] {
  const pages: PdfPage[] = [];
  for (const unit of units) {
    const page = pages.at(-1);
    if (page && unit.bottom - page.top <= maxHeight) page.bottom = Math.max(page.bottom, unit.bottom);
    else pages.push({ top: unit.top, bottom: unit.bottom });
  }
  return pages;
}

export async function exportPdf(source: HTMLElement, settings: ExportSettings, name: string, documentTitle: string) {
  const { jsPDF } = await import('jspdf');
  const sheet = await renderSheet(source, settings, Math.max(2, settings.quality));
  const landscape = sheet.width / sheet.height > 1.25;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const mmPerPx = (pageW - margin * 2) / sheet.width;
  const maxHeightPx = (pageH - margin * 2) / mmPerPx;
  const pages = paginate(sheet.units.length ? sheet.units : [{ top: 0, bottom: sheet.height }], maxHeightPx);
  const ratio = sheet.canvas.width / sheet.width;
  const fill = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(sheet.background);
  const rgb: [number, number, number] = fill && fill[4] !== '0' ? [Number(fill[1]), Number(fill[2]), Number(fill[3])] : [255, 255, 255];
  pdf.setProperties({ title: documentTitle, creator: 'GuitarAP' });
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage();
    pdf.setFillColor(...rgb);
    pdf.rect(0, 0, pageW, pageH, 'F');
    const heightPx = page.bottom - page.top;
    const fit = Math.min(1, maxHeightPx / heightPx);
    const crop = document.createElement('canvas');
    crop.width = sheet.canvas.width;
    crop.height = Math.max(1, Math.round(heightPx * ratio));
    crop.getContext('2d')!.drawImage(sheet.canvas, 0, Math.round(page.top * ratio), crop.width, crop.height, 0, 0, crop.width, crop.height);
    const w = (pageW - margin * 2) * fit;
    const h = heightPx * mmPerPx * fit;
    pdf.addImage(crop.toDataURL('image/png'), 'PNG', margin + (pageW - margin * 2 - w) / 2, margin, w, h);
  });
  pdf.save(name);
  return { pages: pages.length };
}
