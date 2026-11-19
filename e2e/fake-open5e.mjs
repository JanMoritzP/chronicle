// A tiny stand-in for the Open5e API, so the library tests never need the internet.
// node fake-open5e.mjs <port>
import http from 'node:http'

const doc = 'srd-2014'
const data = {
  documents: [{ key: doc, name: 'SRD 2014', display_name: 'System Reference Document 5.1', publication_date: '2014-01-01', licenses: [{ name: 'Open Gaming License' }], gamesystem: { key: '5e-2014' }, permalink: 'https://example.test/srd' }],
  spells: [
    {
      key: 'srd_fireball', name: 'Fireball', document: doc, level: 3, school: { name: 'Evocation', key: 'evocation' }, casting_time: 'action', range_text: '150 feet', duration: 'instantaneous',
      concentration: false, ritual: false, verbal: true, somatic: true, material: true, material_specified: 'a tiny ball of bat guano and sulfur',
      desc: 'A bright streak flashes to a point you choose. Each creature in a 20-foot-radius sphere takes 8d6 fire damage.',
      higher_level: 'The damage increases by 1d6 for each slot level above 3rd.', classes: [{ name: 'Wizard', key: 'wizard' }],
    },
    {
      key: 'srd_light', name: 'Light', document: doc, level: 0, school: { name: 'Evocation', key: 'evocation' }, casting_time: 'action', range_text: 'Touch', duration: '1 hour',
      concentration: false, ritual: false, verbal: true, somatic: false, material: false, desc: 'You touch one object. It sheds bright light for an hour.', classes: [{ name: 'Wizard', key: 'wizard' }],
    },
  ],
  creatures: [
    {
      key: 'srd_goblin', name: 'Goblin', document: doc, challenge_rating: 0.25, size: { name: 'Small', key: 'small' }, type: { name: 'Humanoid', key: 'humanoid' }, alignment: 'neutral evil',
      armor_class: 15, hit_points: 7, hit_dice: '2d6', speed: { walk: 30 }, ability_scores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
      passive_perception: 9, languages: { as_string: 'Common, Goblin' },
      traits: [{ name: 'Nimble Escape', desc: 'The goblin can take the Disengage or Hide action as a bonus action.' }],
      actions: [{ name: 'Scimitar', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' }],
    },
    {
      key: 'srd_wolf', name: 'Wolf', document: doc, challenge_rating: 0.25, size: { name: 'Medium', key: 'medium' }, type: { name: 'Beast', key: 'beast' }, alignment: 'unaligned',
      armor_class: 13, hit_points: 11, hit_dice: '2d8', speed: { walk: 40 }, ability_scores: { strength: 12, dexterity: 15, constitution: 12, intelligence: 3, wisdom: 12, charisma: 6 },
      passive_perception: 13, languages: { as_string: '' }, traits: [], actions: [{ name: 'Bite', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage.' }],
    },
  ],
  magicitems: [{ key: 'srd_bag-of-holding', name: 'Bag of Holding', document: doc, rarity: { name: 'Uncommon' }, category: { name: 'Wondrous Item' }, requires_attunement: false, desc: 'This bag has an interior space considerably larger than its outside dimensions.' }],
  conditions: [{ key: 'srd_prone', name: 'Prone', document: doc, descriptions: [{ desc: 'A prone creature can only crawl until it stands up.' }] }],
  damagetypes: [{ key: 'srd_fire', name: 'Fire', document: doc, desc: 'Flames and hot gases.' }],
  spellschools: [{ key: 'srd_evocation', name: 'Evocation', document: doc, desc: 'Evocation spells manipulate magical energy.' }],
}

const port = Number(process.argv[2])
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const m = /^\/v2\/([a-z]+)\/?$/.exec(url.pathname)
  res.setHeader('content-type', 'application/json')
  if (!m) { res.statusCode = 404; res.end('{}'); return }
  const results = data[m[1]] ?? []
  res.end(JSON.stringify({ count: results.length, next: null, results }))
}).listen(port, '127.0.0.1')
