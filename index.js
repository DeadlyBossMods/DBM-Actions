const core = require('@actions/core');
const glob = require('glob');
const fs = require('fs');

let didFail = false;
const skipFunctions = [
	'SPELL_INTERRUPT',
	'OnCombatStart',
]

const
	// Registering events: `mod:RegisterShortTermEvents`, etc...
	REGEX_REGISTER_EVENT = /(mod|self):Register(ShortTermEvents|Events(InCombat)?)\(/i,
	// Event registration: `EVENT_TYPE spellID's`
	REGEX_EVENT = /^"([^\s"]+)\s?([\d\s]+)?",?/,
	// Cross-references: `mod.EVENT1 = mod.EVENT2`
	REGEX_CROSS_REFERENCE = /^mod\.(.*?)\s?=\s?mod\.(.*?)$/i,

	// Function start: `function mod:EVENT
	REGEX_FUNCTION = /^function mod:(\w+)/i,
	// SpellID equals
	REGEX_SPELLID_EQUALS = /spellid == (\d+)/ig,
	// SpellID function
	REGEX_SPELLID_FUNC = /IsSpellID\(([^)]+)\)/ig
;

const processFile = (file) => {
	core.debug('Processing: ' + file);
	const lines = fs.readFileSync(file).toString().split("\n");

	let failed = [],
		registeredEvents = {},
		checkingList = false,
		skipComment = false,
		lastFunction = null;

	// Check for registering events
	lines.forEach(line => {
		line = line.trim();

		if (line.match(REGEX_REGISTER_EVENT)) { // Start checking for registered events
			checkingList = true;
		} else if (checkingList && line === ')') { // Closing tag for registered events
			checkingList = false;
		} else if (checkingList) { // Process registered events
			const _match = line.match(REGEX_EVENT);
			if (! _match) {
				return;
			}
			if (! _match[2]) {
				registeredEvents[_match[1]] = [];
			} else {
				if (! registeredEvents[_match[1]]) {
					registeredEvents[_match[1]] = [];
				}
				_match[2].split(' ').forEach(spellID => registeredEvents[_match[1]].push(spellID));
			}
		} else if (line.match(REGEX_CROSS_REFERENCE)) { // Cross-reference: mod.EVENT1 = mod.EVENT2
			const _match = line.match(REGEX_CROSS_REFERENCE);
			if (! registeredEvents[_match[1]]) {
				registeredEvents[_match[1]] = [];
			}
			if (! registeredEvents[_match[2]]) {
				registeredEvents[_match[2]] = [];
			}
			registeredEvents[_match[1]].forEach(spellID => registeredEvents[_match[2]].push(spellID));
			registeredEvents[_match[2]].forEach(spellID => registeredEvents[_match[1]].push(spellID));
		}
	});

	// Scan for functions
	lines.forEach(line => {
		line = line.trim();

		if (line === '--[[') { // Comment start
			skipComment = true
		} else if (line === '--]]') { // Comment end
			skipComment = false;
		} else if (skipComment || line.startsWith('--')) { // Comment line
			// Do nothing
		} else if (line.match(REGEX_FUNCTION)) { // Starting a function
			lastFunction = line.match(REGEX_FUNCTION)[1];
		} else if (lastFunction) { // Inside a function, check for SpellID usage
			if (lastFunction.toLowerCase().startsWith('unit_') || skipFunctions.indexOf(lastFunction) !== -1) {
				return;
			}
			[...line.matchAll(REGEX_SPELLID_EQUALS)].forEach(_match => {
				if (! registeredEvents[lastFunction]) {
					failed.push(`Event isn\'t registered: ${lastFunction}\t${_match[1]}`);
				} else if (registeredEvents[lastFunction].length > 0 && registeredEvents[lastFunction].indexOf(_match[1]) === -1) {
					failed.push(`SpellID not registered: ${lastFunction}\t${_match[1]}`);
				}
			});
			[...line.matchAll(REGEX_SPELLID_FUNC)].forEach(_match => {
				_match[1].replace(',', '').split(' ').forEach(spellID => {
					if ( !registeredEvents[lastFunction]) {
						failed.push(`Event isn\'t registered: ${lastFunction}\t${spellID}`);
					} else if (registeredEvents[lastFunction].length > 0 && registeredEvents[lastFunction].indexOf(spellID) === -1) {
						failed.push(`SpellID not registered: ${lastFunction}\t${spellID}`);
					}
				});
			});
		}
	});
	if (failed.length > 0) {
		core.error('Processing failed for: ' + file);
		failed.forEach(fail => core.error(fail));
		didFail = true;
	} else {
		core.debug('OK!');
	}
}

glob('./**/*.lua', {}, (err, files) => {
	files.forEach(file => processFile(file));
	if (didFail) {
		core.setFailed('One or more SpellID\'s is not registered.');
	}
});