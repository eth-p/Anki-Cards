// ---------------------------------------------------------------------------------------------------------------------
// Anki-Cards | Copyright (C) 2018 eth-p
// ---------------------------------------------------------------------------------------------------------------------
// Import:

'use strict';
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
const sqlite3   = require('sqlite3');
const zip       = require('node-zip');
const util      = require('util');
const crypto    = require('crypto');

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
 * The completed package file.
 * @type {string}
 */
const DEST_PKG = path.join(DEST, 'Anki-Cards.apkg');

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
	 * Asynchronously read a file and return its name, contents, and stat.
	 *
	 * @param {string} file The file to read.
	 * @async
	 */
	static async read_file(file) {
		return {
			name: file,
			contents: await fse.readFile(file, {encoding: 'utf8'}),
			stat: await fse.stat(file)
		}
	}

	/**
	 * Asynchronously read all the generated HTML files for a card.
	 *
	 * @param {string} card The name of the card to read.
	 * @async
	 */
	static async read_card_html(card) {
		// Find the generated card faces.
		const dir   = path.join(DEST, card);
		const files = (await fse.readdir(dir))
			.filter((entry) => REGEX_CARD_FACE_GENERATED.test(path.basename(entry)));

		// Read the HTML card faces.
		let html = await Promise.all(files.map((file) => Util.read_file(path.join(dir, file))));

		// Categorize the HTML card faces.
		const regex = REGEX_CARD_FACE_GENERATED;

		let cards = [];
		for (let file of html) {
			let captures = path.basename(file.name).match(regex);
			let index    = parseInt(captures[1]);
			let card     = index in cards ? cards[index] : (cards[index] = {});

			card[captures[2].toLowerCase()] = file.contents;
		}

		return cards.filter((val) => val != null);
	}

	/**
	 * Asynchronously read the generated CSS file for a card.
	 *
	 * @param {string} card The name of the card to read.
	 * @async
	 */
	static async read_card_style(card) {
		return (await (Util.read_file(path.join(DEST, card, 'Style.css')))).contents;
	}

	/**
	 * Asynchronously read the Metadata.json file for a card.
	 *
	 * @param {string} card The name of the card to read.
	 * @async
	 */
	static async read_card_metadata(card) {
		let read = (await (Util.read_file(path.join(__dirname, card, 'Metadata.json'))));
		return Object.assign({}, JSON.parse(read.contents), {
			modified: read.stat.mtime.getTime()
		});
	}

	/**
	 * Remove the template tags from generated card HTML.
	 * This is useful for generating previews.
	 *
	 * @param {object} card An object containing the card HTML.
	 */
	static html_detemplate(card) {
		const REGEX_TEMPLATE_FIELD       = /{{([\w\-]+)}}/g;
		const REGEX_TEMPLATE_CONDITIONAL = /{{[\^\#\/][\w\-]+}}/g;
		const copy                       = {};

		for (let key in card) {
			if (card.hasOwnProperty(key)) {
				copy[key] = card[key]
					.replace(REGEX_TEMPLATE_FIELD, (match, field) => `(${field})`)
					.replace(REGEX_TEMPLATE_CONDITIONAL, "");
			}
		}

		return copy;
	}

	/**
	 * Generate an Anki2 "model" for a card.
	 *
	 * @param {object} metadata The card's Metadata.json file.
	 * @async
	 */
	static anki2_card_model(metadata) {
		let model = {};

		// Constants.

		const DEFAULT_LATEX_PRE = [
			"\\documentclass[12pt]{article}",
			"\\special{papersize=3in,5in}",
			"\\usepackage[utf8]{inputenc}",
			"\\usepackage{amssymb,amsmath}",
			"\\pagestyle{empty}",
			"\\setlength{\\parindent}{0in}",
			"\\begin{document}"
		];

		const DEFAULT_LATEX_POST = [
			"\\end{document}"
		];

		// Metadata (Required) -> Model
		model.id   = metadata.id;
		model.name = metadata.name;
		model.mod  = metadata.modified;

		// Metadata (Constant) -> Model
		model.did   = 0;
		model.css   = '';
		model.tmpls = [];
		model.flds  = [];

		// Metadata (Optional) -> Model
		model.latexPre = ('latexPre' in metadata ? metadata.latexPre : DEFAULT_LATEX_PRE).join("\n");
		model.latexPre = ('latexPost' in metadata ? metadata.latexPost : DEFAULT_LATEX_POST).join("\n");
		model.type     = 'type' in metadata ? metadata.type : 0;
		model.tags     = 'tags' in metadata ? metadata.tags : [];
		model.usn      = 'revision' in metadata ? metadata['revision'] : 0;
		model.req      = 'anki-req' in metadata ? metadata['anki-req'] : [[0, 'all', [0]]];
		model.sortf    = 'sort-by' in metadata ? metadata['sort-by'] : 0;
		model.vers     = 'anki-vers' in metadata ? metadata['anki-vers'] : [];

		// Metadata Fields -> Model.flds
		for (let [entry, field] of Object.entries(metadata.fields)) {
			model.flds.push({
				name: field.name,
				rtl: 'rtl' in field ? field.rtl : false,
				sticky: 'sticky' in field ? field.sticky : false,
				media: 'media' in field ? field.media : [],
				ord: 'anki-ord' in field ? parseInt(field['anki-ord']) : parseInt(entry),
				font: 'font-family' in field ? field['font-family'] : 'Arial',
				size: 'font-size' in field ? field['font-size'] : 20
			})
		}

		// Return.
		return model;
	}

	/**
	 * Generate an Anki2 "note" for a card.
	 *
	 * @param {object} metadata The card's Metadata.json file.
	 * @async
	 */
	static anki2_card_note(metadata) {
		let note = {};

		// Metadata (Required) -> Model
		note.id   = metadata.id;
		note.guid = metadata.name;
		note.mid  = metadata.id;
		note.mod  = metadata.modified;

		// Metadata (Optional) -> Model
		note.usn  = 'revision' in metadata ? metadata['revision'] : 0;
		note.tags = 'tags' in metadata ? metadata.tags : [];

		note.flds = '<Automatically Generated>' + "\x1F".repeat(metadata.fields.length - 1);
		note.sfld = '<Automatically Generated>' + "\x1F".repeat(metadata.fields.length - 1);

		// Metadata (Constant) -> Model
		note.csum  = parseInt(crypto.createHash('sha1').update(note.sfld).digest('hex').substring(0, 8), 16);
		note.flags = 0;
		note.data  = 0;

		// Return.
		return note;
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

		// Generate preview data.
		// This will read all the preview files (for dynamic inclusion).
		let data = [];
		await Promise.all(cards.map((card) => (async () => {
			data[card] = {
				previews: (await Util.read_card_html(card)).map((c) => Util.html_detemplate(c))
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

	static async package() {
		// Constants.
		const COLLECTION_ID            = 301300009000;
		const COLLECTION_TIME_CREATED  = 1520465137;
		const COLLECTION_TIME_MODIFIED = Date.now();

		// Read card information.
		const cards = await Promise.all(CARDS.map((card) => {
			return (async () => {
				let promises = {
					style: Util.read_card_style(card),
					metadata: Util.read_card_metadata(card),
					templates: Util.read_card_html(card)
				};

				let result = {
					name: card
				};

				for (let property of Object.getOwnPropertyNames(promises)) {
					result[property] = await promises[property];
				}

				return result;
			})();
		}));

		// Generate model and notes.
		let models = {};
		let notes  = {};

		for (let card of cards) {
			let model = Util.anki2_card_model(card.metadata);
			let note  = Util.anki2_card_note(card.metadata);

			model.css   = card.style;
			model.tmpls = card.templates.map((template, index) => {
				let indexNormal = parseInt(index) + 1;
				let name        = `Card ${indexNormal}`;

				if ('cards' in card.metadata && indexNormal in card.metadata.cards) {
					name = card.metadata.cards[indexNormal];
				}

				return {
					name: name,
					bqfmt: "",
					qfmt: template.front,
					did: 0,
					bafmt: "",
					afmt: template.back,
					ord: index
				}
			});

			models[model.id] = model;
			notes[note.id]   = note;
		}

		// Generate tag list.
		let tags = {};
		for (let card of cards) {
			if (card.metadata.tags instanceof Array) {
				for (let tag of card.metadata.tags) {
					tags[tag] = true;
				}
			}
		}

		// Generate database.
		const databaseFile = path.join(DEST, 'collection.anki2');

		try {
			await fse.unlink(databaseFile);
		} catch (ex) {
		}

		const databaseTemplate = await fse.readFile(path.join(__dirname, 'Anki2.sql'), 'utf8');
		const database         = new sqlite3.Database(databaseFile);

		database.serialize(() => {
			database.exec(databaseTemplate);
			database.run('INSERT INTO col VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
				COLLECTION_ID,
				COLLECTION_TIME_CREATED,
				COLLECTION_TIME_MODIFIED,
				COLLECTION_TIME_MODIFIED,
				11, // Schema version.
				0,
				0,
				0,
				'{}',
				JSON.stringify(models),
				'{}',
				'{}',
				JSON.stringify(tags)
			);

			for (let note of Object.values(notes)) {
				database.run('INSERT INTO notes VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
					note.id,
					note.guid,
					note.mid,
					note.mod,
					note.usn,
					JSON.stringify(note.tags),
					note.flds,
					note.sfld,
					note.csum,
					note.flags,
					note.data
				);
			}
		});

		await util.promisify(database.close.bind(database))();

		// Generate apkg.
		let apkg = zip();
		apkg.file('collection.anki2', await fse.readFile(databaseFile));
		apkg.file('media', '{}');

		let apkgData = apkg.generate({base64: false, compression: 'DEFLATE'});
		await fse.writeFile(DEST_PKG, apkgData, 'binary');
	}

}

// ---------------------------------------------------------------------------------------------------------------------
// Tasks:

gulp.task('compile:pug', () => Tasks.compile_pug(SRC_PUG));
gulp.task('compile:scss', () => Tasks.compile_scss(SRC_SCSS));
gulp.task('generate:preview', () => Tasks.generate_preview(CARDS, false));
gulp.task('generate:screenshot', () => Tasks.generate_preview(CARDS, true));
gulp.task('package', () => Tasks.package());

gulp.task('default', gulp.series(
	gulp.parallel('compile:pug', 'compile:scss'),
	gulp.parallel('generate:screenshot', 'package')
));

// ---------------------------------------------------------------------------------------------------------------------
// Watch:

if (WATCH) {
	gulp.watch(['**/*.pug', '**/*.scss'], (c) => c()).on('change', debounce(
		async function rebuild(changed) {
			const file        = path.parse(changed);
			const shared      = file.dir === '';
			let affectedFiles = null;
			let affectedCards = null;

			// Is it just the preview file?
			if (shared && file.base === 'Preview.pug') {
				await stp(Tasks.generate_preview(CARDS, false));
				return;
			}

			// What cards are affected?
			affectedCards = shared ? CARDS : [file.dir.split(path.sep)[0]];

			// What sources are affected?
			switch (file.ext.toLowerCase()) {
				case '.scss': {
					affectedFiles = shared ? SRC_SCSS : affectedCards.map((card) => path.join(card, 'Style.scss'));
					break;
				}

				case '.pug': {
					affectedFiles = shared ? SRC_PUG : [changed];
					break;
				}
			}

			// Do something!
			switch (file.ext.toLowerCase()) {
				case '.scss': {
					await stp(Tasks.compile_scss(affectedFiles));
					await stp(Tasks.generate_preview(affectedCards, false));
					break;
				}

				case '.pug': {
					await stp(Tasks.compile_pug(affectedFiles));
					await stp(Tasks.generate_preview(affectedCards, false));
					break;
				}
			}
		}, 300));
}
