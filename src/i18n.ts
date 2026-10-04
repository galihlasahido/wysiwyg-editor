/** Translations of toolbar labels, keyed by toolbar item name (and `name.value` for dropdown options). */
export type Locale = Record<string, string>;

const locales = new Map<string, Locale>();

export function registerLocale(code: string, strings: Locale): void {
  locales.set(code, { ...locales.get(code), ...strings });
}

/** Look up `key`, falling back to the English label from the plugin. */
export function translate(code: string | undefined, key: string, fallback: string): string {
  if (!code) return fallback;
  return locales.get(code)?.[key] ?? locales.get(code.split('-')[0])?.[key] ?? fallback;
}

export function isRtlLocale(code: string | undefined): boolean {
  return !!code && /^(ar|he|fa|ur)(-|$)/.test(code);
}

registerLocale('id', {
  undo: 'Urungkan', redo: 'Ulangi', bold: 'Tebal', italic: 'Miring', underline: 'Garis bawah', strike: 'Coret', code: 'Kode sebaris',
  heading: 'Gaya paragraf', 'heading.paragraph': 'Paragraf', 'heading.1': 'Judul 1', 'heading.2': 'Judul 2', 'heading.3': 'Judul 3', 'heading.4': 'Judul 4',
  fontFamily: 'Jenis huruf', fontSize: 'Ukuran huruf', lineHeight: 'Spasi baris', textColor: 'Warna teks', highlight: 'Sorot',
  'align-left': 'Rata kiri', 'align-center': 'Rata tengah', 'align-right': 'Rata kanan', 'align-justify': 'Rata kiri-kanan',
  bulletList: 'Daftar poin', orderedList: 'Daftar bernomor', taskList: 'Daftar centang', outdent: 'Kurangi indentasi', indent: 'Tambah indentasi',
  blockQuote: 'Kutipan', codeBlock: 'Blok kode', horizontalRule: 'Garis horizontal', link: 'Tautan', image: 'Sisipkan gambar dari URL', uploadImage: 'Unggah gambar',
  imageCaption: 'Keterangan gambar (pilih gambar)', insertTable: 'Sisipkan tabel', addRow: 'Tambah baris di bawah', addColumn: 'Tambah kolom di kanan',
  deleteRow: 'Hapus baris', deleteColumn: 'Hapus kolom', deleteTable: 'Hapus tabel', mergeCells: 'Gabungkan sel', splitCell: 'Pisahkan sel',
  toggleHeaderRow: 'Baris judul', cellColor: 'Warna sel', find: 'Cari & ganti (Ctrl+F)', specialCharacters: 'Karakter khusus', formatPainter: 'Salin format',
  footnote: 'Sisipkan catatan kaki', toc: 'Sisipkan daftar isi', spellcheck: 'Pemeriksa ejaan', pageSize: 'Ukuran halaman', pageOrientation: 'Orientasi',
  'pageOrientation.portrait': 'Potret', 'pageOrientation.landscape': 'Lanskap', pageBreak: 'Pemisah halaman (Ctrl+Enter)', print: 'Cetak / Simpan sebagai PDF',
  comment: 'Tambah komentar', trackChanges: 'Mode saran', acceptAll: 'Terima semua perubahan', rejectAll: 'Tolak semua perubahan', versions: 'Riwayat versi',
  ai: 'Asisten AI', direction: 'Arah teks', template: 'Templat',
  // ribbon
  ribbon: 'Pita', collapseRibbon: 'Ciutkan pita', zoom: 'Perbesar/perkecil', showShortcuts: 'Pintasan keyboard', wordCount: 'Hitung kata',
  'tab.file': 'Berkas', 'tab.home': 'Beranda', 'tab.insert': 'Sisipkan', 'tab.layout': 'Tata letak', 'tab.references': 'Referensi', 'tab.review': 'Tinjau', 'tab.view': 'Tampilan', 'tab.help': 'Bantuan', 'tab.table': 'Tabel', 'tab.picture': 'Gambar', 'group.crop': 'Potong', 'group.imgsize': 'Ukuran', 'group.imgtext': 'Teks', 'r.cropImage': 'Potong', 'r.resetCrop': 'Atur ulang potongan', 'r.imageWidth': 'Lebar', 'r.imageCaption': 'Keterangan', 'r.imageAlt': 'Teks alternatif',
  'group.new': 'Baru', 'group.export': 'Ekspor', 'group.undo': 'Urungkan', 'group.clipboard': 'Papan klip', 'group.font': 'Font', 'group.paragraph': 'Paragraf', 'group.styles': 'Gaya', 'group.editing': 'Penyuntingan',
  'group.pages': 'Halaman', 'group.tables': 'Tabel', 'group.illustrations': 'Ilustrasi', 'group.links': 'Tautan', 'group.toc': 'Daftar isi', 'group.comments': 'Komentar', 'group.hf': 'Header & Footer', 'group.blocks': 'Blok',
  'group.symbols': 'Simbol', 'group.emoji': 'Emoji', 'group.setup': 'Pengaturan halaman', 'group.background': 'Latar halaman', 'group.notes': 'Catatan kaki', 'group.proofing': 'Pemeriksaan', 'group.ai': 'AI',
  'group.tracking': 'Pelacakan', 'group.history': 'Riwayat', 'group.views': 'Tampilan dokumen', 'group.zoom': 'Zoom', 'group.show': 'Tampilkan', 'group.dark': 'Mode gelap', 'group.help': 'Bantuan', 'group.rows': 'Baris & kolom', 'group.merge': 'Gabung', 'group.style': 'Gaya tabel',
  'r.new': 'Baru', 'r.html': 'HTML', 'r.md': 'Markdown', 'r.opendocx': 'Buka .docx', 'r.docx': 'Ekspor .docx', 'r.paste': 'Tempel', 'r.cut': 'Potong', 'r.copy': 'Salin', 'r.formatPainter': 'Kuas format',
  'r.grow': 'Perbesar font', 'r.shrink': 'Perkecil font', 'r.clear': 'Hapus semua format', 'r.textColor': 'Warna font', 'r.highlight': 'Warna sorot', 'r.outdent': 'Kurangi indentasi', 'r.indent': 'Tambah indentasi',
  'r.lineSpacing': 'Spasi baris', 'r.find': 'Cari', 'r.replace': 'Ganti', 'r.select': 'Pilih semua', 'r.pageBreak': 'Pemisah halaman', 'r.table': 'Tabel', 'r.picture': 'Gambar', 'r.link': 'Tautan', 'r.toc': 'Daftar isi',
  'r.comment': 'Komentar baru', 'r.hf': 'Header & Footer', 'r.pageNumber': 'Nomor halaman', 'r.horizontalRule': 'Garis horizontal', 'r.blockQuote': 'Kutipan', 'r.codeBlock': 'Blok kode', 'r.symbol': 'Simbol', 'r.emoji': 'Emoji',
  'r.margins': 'Margin', 'r.orientation': 'Orientasi', 'r.size': 'Ukuran', 'r.breaks': 'Pemisah', 'r.indentLeft': 'Kiri', 'r.indentRight': 'Kanan', 'r.spaceBefore': 'Sebelum', 'r.spaceAfter': 'Sesudah', 'r.pageColor': 'Warna halaman',
  'r.updateToc': 'Perbarui daftar', 'r.removeToc': 'Hapus daftar', 'r.footnote': 'Sisipkan catatan kaki', 'r.endnote': 'Sisipkan catatan akhir', 'r.spellcheck': 'Ejaan', 'r.wordCount': 'Hitung kata', 'r.ai': 'Asisten AI',
  'r.prevComment': 'Sebelumnya', 'r.nextComment': 'Berikutnya', 'r.deleteComment': 'Hapus', 'r.showComments': 'Tampilkan komentar', 'r.trackChanges': 'Lacak perubahan', 'r.accept': 'Terima', 'r.reject': 'Tolak',
  'r.prevChange': 'Sebelumnya', 'r.nextChange': 'Berikutnya', 'r.versions': 'Versi', 'r.pages': 'Halaman terpisah', 'r.reading': 'Tampilan baca', 'r.zoom100': '100%', 'r.ruler': 'Penggaris', 'r.nav': 'Navigasi',
  'r.hfv': 'Header & Footer', 'r.fnv': 'Catatan kaki', 'r.theme': 'Mode gelap', 'r.bg': 'Ganti latar', 'r.shortcuts': 'Pintasan keyboard', 'r.about': 'Tentang', 'r.print': 'Cetak / PDF',
  'r.addRow': 'Sisipkan baris', 'r.addColumn': 'Sisipkan kolom', 'r.deleteRow': 'Hapus baris', 'r.deleteColumn': 'Hapus kolom', 'r.deleteTable': 'Hapus tabel', 'r.mergeCells': 'Gabung sel', 'r.splitCell': 'Pisah sel',
  'r.toggleHeaderRow': 'Baris judul', 'r.shading': 'Arsiran', 'none.textColor': 'Otomatis', 'none.highlight': 'Tanpa warna', 'none.pageColor': 'Otomatis', 'none.shading': 'Tanpa arsiran',
});

registerLocale('es', {
  undo: 'Deshacer', redo: 'Rehacer', bold: 'Negrita', italic: 'Cursiva', underline: 'Subrayado', strike: 'Tachado', code: 'Código en línea',
  heading: 'Estilo de párrafo', 'heading.paragraph': 'Párrafo', 'heading.1': 'Título 1', 'heading.2': 'Título 2', 'heading.3': 'Título 3', 'heading.4': 'Título 4',
  fontFamily: 'Fuente', fontSize: 'Tamaño de fuente', lineHeight: 'Interlineado', textColor: 'Color del texto', highlight: 'Resaltar',
  'align-left': 'Alinear a la izquierda', 'align-center': 'Centrar', 'align-right': 'Alinear a la derecha', 'align-justify': 'Justificar',
  bulletList: 'Lista con viñetas', orderedList: 'Lista numerada', taskList: 'Lista de tareas', outdent: 'Reducir sangría', indent: 'Aumentar sangría',
  blockQuote: 'Cita', codeBlock: 'Bloque de código', horizontalRule: 'Línea horizontal', link: 'Enlace', image: 'Insertar imagen desde URL', uploadImage: 'Subir imagen',
  insertTable: 'Insertar tabla', find: 'Buscar y reemplazar (Ctrl+F)', footnote: 'Insertar nota al pie', toc: 'Insertar tabla de contenido',
  pageSize: 'Tamaño de página', pageBreak: 'Salto de página (Ctrl+Enter)', print: 'Imprimir / Guardar como PDF', comment: 'Añadir comentario',
  trackChanges: 'Modo de sugerencias', versions: 'Historial de versiones', ai: 'Asistente de IA', direction: 'Dirección del texto', template: 'Plantilla',
});

registerLocale('ar', {
  undo: 'تراجع', redo: 'إعادة', bold: 'غامق', italic: 'مائل', underline: 'تسطير', strike: 'يتوسطه خط', code: 'رمز مضمن',
  heading: 'نمط الفقرة', 'heading.paragraph': 'فقرة', 'heading.1': 'عنوان 1', 'heading.2': 'عنوان 2', 'heading.3': 'عنوان 3', 'heading.4': 'عنوان 4',
  fontFamily: 'الخط', fontSize: 'حجم الخط', textColor: 'لون النص', highlight: 'تمييز',
  'align-left': 'محاذاة لليسار', 'align-center': 'توسيط', 'align-right': 'محاذاة لليمين', 'align-justify': 'ضبط',
  bulletList: 'قائمة نقطية', orderedList: 'قائمة مرقمة', taskList: 'قائمة مهام', blockQuote: 'اقتباس', codeBlock: 'كتلة رمز', link: 'رابط',
  image: 'إدراج صورة من رابط', insertTable: 'إدراج جدول', find: 'بحث واستبدال (Ctrl+F)', footnote: 'إدراج حاشية', print: 'طباعة / حفظ كـ PDF',
  comment: 'إضافة تعليق', versions: 'سجل الإصدارات', direction: 'اتجاه النص', template: 'قالب',
});
