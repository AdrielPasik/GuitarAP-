import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

function filename(title: string, extension: string) {
  return `${title.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'guitarap'}.${extension}`;
}

function download(dataUrl: string, name: string) {
  const link = window.document.createElement('a');
  link.download = name;
  link.href = dataUrl;
  link.click();
}

export async function exportPng(element: HTMLElement, title: string) {
  const dataUrl = await toPng(element, { backgroundColor: '#fffdf8', pixelRatio: 2, cacheBust: true });
  download(dataUrl, filename(title, 'png'));
}

export async function exportPdf(element: HTMLElement, title: string) {
  const dataUrl = await toPng(element, { backgroundColor: '#fffdf8', pixelRatio: 2, cacheBust: true });
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const landscape = image.width >= image.height;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'px', format: [image.width, image.height], compress: true });
  pdf.addImage(dataUrl, 'PNG', 0, 0, image.width, image.height);
  pdf.save(filename(title, 'pdf'));
}
