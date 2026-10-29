export const expressionCues = [
  { label:'Cười', tag:'[cười]' },
  { label:'Thở dài', tag:'[thở dài]' },
  { label:'Hắng giọng', tag:'[hắng giọng]' },
];
const pattern = () => /\[(?:cười|thở dài|hắng giọng)\]/giu;
export const countCues = text => [...text.matchAll(pattern())].length;
export const stripCues = text => text.replace(pattern(),' ').replace(/[ \t]+/gu,' ').replace(/ +([.,!?;:])/gu,'$1').trim();
