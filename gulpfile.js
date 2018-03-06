// ---------------------------------------------------------------------------------------------------------------------
// Anki-Cards | Copyright (C) 2018 eth-p
// ---------------------------------------------------------------------------------------------------------------------
const gulp      = require('gulp');
const g_pug     = require('gulp-pug');
const g_sass    = require('gulp-sass');
const g_debug   = require('gulp-debug');
const g_file    = require('gulp-file');
const g_webshot = require('gulp-webshot');
const g_noop    = require('gulp-noop');
const pug       = require('pug');
const path      = require('path');
const stp       = require('stream-to-promise');
const fse       = require('fs-extra');

// ---------------------------------------------------------------------------------------------------------------------
// Config:

const SRC_PUG         = ['**/Back.pug', '**/Front.pug', '!Template.pug', '!Preview.pug'];
const SRC_SCSS        = ['**/Style.scss', '!Template.scss', '!Theme.scss', '!Material.scss'];
const DEST            = path.join(__dirname, 'Release');
const CARDS           = ((dir) => {
	let files = fse.readdirSync(dir);
	let cards = [];

	for (let file of files) {
		let card = path.join(dir, file);
		if (fse.statSync(card).isDirectory() && fse.existsSync(path.join(card, 'Front.pug'))) {
			cards.push(path.relative(dir, card));
		}
	}

	return cards;
})(__dirname);

// ---------------------------------------------------------------------------------------------------------------------
// Build:

class Tasks {

	static compile_pug(files) {
		return gulp.src([].concat(files, ['!node_modules/**/*', `!${DEST}/**/*`]), {base: __dirname, sourcemaps: false})
			.pipe(g_debug())
			.pipe(g_pug())
			.pipe(gulp.dest(DEST));
	}

	static compile_scss(files) {
		return gulp.src([].concat(files, ['!node_modules/**/*', `!${DEST}/**/*`]), {base: __dirname, sourcemaps: true})
			.pipe(g_debug())
			.pipe(g_sass({outputStyle: 'compressed'}))
			.pipe(gulp.dest(DEST, {sourcemaps: '.'}));
	}

	static async generate_preview(files, screenshot) {
		const preview  = await fse.readFile(path.join(__dirname, 'Preview.pug'));
		const previews = CARDS.map((card) => {
			return {
				name: path.join(DEST, card, 'Preview.pug'),
				source: preview
			}
		});

		return g_file(previews, {src: true})
			.pipe(g_pug())
			.pipe(g_debug())
			.pipe(gulp.dest(__dirname))
			.pipe((!screenshot ? g_noop : g_webshot)({
				dest: __dirname,
				root: '.',
				screenSize: {
					width: 360 * 2 + 15,
					height: 640 + 10
				}
			}));
	}

}

// ---------------------------------------------------------------------------------------------------------------------
// Tasks:

gulp.task('compile:pug', () => Tasks.compile_pug(SRC_PUG));
gulp.task('compile:scss', () => Tasks.compile_scss(SRC_SCSS));
gulp.task('generate:preview', () => Tasks.generate_preview(CARDS, true));

gulp.task('default', gulp.series(gulp.parallel('compile:pug', 'compile:scss'), 'generate:preview'));

// ---------------------------------------------------------------------------------------------------------------------
// Watch:

if (Array.from(process.argv).includes('--watch')) {
	let debounce = null;
	let watcher  = null;

	watcher = gulp.watch(['**/*.pug', '**/*.scss'], (c) => c())
	watcher.on('change', (file, stats) => {
		if (debounce != null) {
			clearTimeout(debounce);
		}

		debounce = setTimeout(async () => {
			const parsed   = path.parse(file);
			const template = (parsed.dir === '' && parsed.name === 'Template');
			const cards    = template ? CARDS : [parsed.dir.split(path.sep)[0]];

			try {
				if (file === 'Preview.pug') {
					await stp(Tasks.generate_preview(CARDS, false));
					return;
				}

				switch (parsed.ext.toLowerCase()) {
					case '.scss': {
						const files = template ? SRC_SCSS : [path.join(parsed.dir, 'Style.scss')];
						await stp(Tasks.compile_scss(files));
						await stp(Tasks.generate_preview(cards, false));
						break;
					}

					case '.pug': {
						const files = template ? SRC_PUG : [file];
						await stp(Tasks.compile_pug(files));
						await stp(Tasks.generate_preview(cards, false));
						break;
					}
				}
			} catch (ex) {
				console.log('Error', ex);
			}

			debounce = null;
		}, 300);
	});
}
