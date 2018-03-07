// ---------------------------------------------------------------------------------------------------------------------
// Anki-Cards | Copyright (C) 2018 eth-p
// ---------------------------------------------------------------------------------------------------------------------
// Import:

const gulp      = require('gulp');
const g_pug     = require('gulp-pug');
const g_sass    = require('gulp-sass');
const g_debug   = require('gulp-debug');
const g_file    = require('gulp-file');
const g_webshot = require('gulp-webshot');
const g_noop    = require('gulp-noop');
const g_data    = require('gulp-data');
const debounce  = require('debounce');
const pug       = require('pug');
const path      = require('path');
const stp       = require('stream-to-promise');
const fse       = require('fs-extra');

// ---------------------------------------------------------------------------------------------------------------------
// Config:

/**
 * The pug source globs.
 * @type {string[]}
 */
const SRC_PUG = [
	'**/*Back.pug',
	'**/*Front.pug',
	'!Template.pug',
	'!Preview.pug'
];

/**
 * The SCSS source globs.
 * @type {string[]}
 */
const SRC_SCSS = [
	'**/Style.scss',
	'!Template.scss',
	'!Theme.scss',
	'!Material.scss'
];

/**
 * The build destination folder.
 * @type {string}
 */
const DEST = path.join(__dirname, 'Release');

/**
 * A regex matcher for card face templates (i.e. <code>n-Front.pug</code>).
 * @type {RegExp}
 */
const REGEX_CARD_FACE_TEMPLATE = /^(?:([\d]+)-)?(Front|Back)\.pug$/;

/**
 * A regex matcher for generated card faces (i.e. <code>n-Front.html</code>).
 * @type {RegExp}
 */
const REGEX_CARD_FACE_GENERATED = /^(?:([\d]+)-)?(Front|Back)\.html$/;

// ---------------------------------------------------------------------------------------------------------------------
// Automatic:

/**
 * A list of card types in Anki-Cards.
 * This is automatically determined by scanning for subdirectories that have face card templates.
 * @type {string[]}
 */
const CARDS = ((dir) => {
	return (fse.readdirSync(dir)).filter((subdir) => {
		if (!fse.statSync(path.join(dir, subdir)).isDirectory()) return false;
		return undefined !== fse.readdirSync(path.join(dir, subdir)).find((filename) => {
			return REGEX_CARD_FACE_TEMPLATE.test(filename);
		});
	});
})(__dirname);

/**
 * Whether or not to watch for changes.
 * This is automatically determined by the existence of the --watch argument.
 * @type {boolean}
 */
const WATCH = Array.from(process.argv).includes('--watch');

// ---------------------------------------------------------------------------------------------------------------------
// Build:

class Util {

	/**
	 * Asynchronously read a file and return its name and contents.
	 *
	 * @param {string} file The file to read.
	 * @async
	 */
	static async read_file(file) {
		return {
			name: file,
			contents: await fse.readFile(file)
		}
	}

	/**
	 * Asynchronously read all the generated HTML files for a card.
	 *
	 * @param {string} card The name of the card to read.
	 * @async
	 */
	static async card_html(card) {
		// Find the HTML files.
		const dir   = path.join(DEST, card);
		const files = (await fse.readdir(dir))
			.filter((v) => path.parse(v).ext.toLowerCase() === '.html');

		// Read the HTML files.
		let html = await Promise.all(files.map((file) => Util.read_file(path.join(dir, file))));

		// Categorize the HTML files.
		const regex = /^(?:([\d]+)-)?(Front|Back)\.html$/;
		let cards   = [];

		for (let file of html) {
			let captures = path.basename(file.name).match(regex);
			if (captures !== null) {
				let index = parseInt(captures[1]);
				let card  = index in cards ? cards[index] : (cards[index] = {});

				card[captures[2].toLowerCase()] = file.contents;
			}
		}

		return cards.filter((val) => val != null);
	}

}

// ---------------------------------------------------------------------------------------------------------------------
// Util:

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

	static async generate_preview(cards, screenshot) {
		let preview_template = await fse.readFile(path.join(__dirname, 'Preview.pug'));
		let preview_files    = cards.map((card) => {
			return {
				name: path.join(DEST, card, 'Preview.pug'),
				source: preview_template
			}
		});

		// Read preview files.
		let data = [];
		await Promise.all(cards.map((card) => (async () => {
			data[card] = {
				cards: await Util.card_html(card)
			};
		})()));

		// Gulp pipeline.
		return g_file(preview_files, {src: true})
			.pipe(g_data((file) => data[path.basename(path.dirname(file.path))]))
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

if (WATCH) {
	gulp.watch(['**/*.pug', '**/*.scss'], (c) => c()).on('change', debounce(
		async function rebuild(file) {
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
		}, 300));
}
