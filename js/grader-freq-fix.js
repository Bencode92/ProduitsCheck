(function(){
var _a=false;
var _c=setInterval(function(){
if(typeof gradeProposal!=='function')return;
if(_a)return;_a=true;clearInterval(_c);
var _og=gradeProposal;
gradeProposal=async function(product){
_fix(product);return _og(product);
};
if(window.ProposalGrader)window.ProposalGrader.grade=gradeProposal;
console.log('[StructBoard] freq-fix v4 ok');
},50);
setTimeout(function(){clearInterval(_c);},10000);
function _fix(p){
if(!p)return;
var ai=p.aiParsed||{};
var co=p.coupon;
var freq=null;
if(ai.coupon&&typeof ai.coupon==='object'){freq=ai.coupon.frequency||ai.coupon.frequence||null;}
if(!freq&&co&&typeof co==='object'){freq=co.frequency||co.frequence||null;}
if(!freq){var er=p.earlyRedemption||ai.earlyRedemption||{};freq=er.frequency||er.frequence||null;}
if(!freq){var nm=(p.name||ai.name||'').toLowerCase();if(/semestriel/i.test(nm)){freq='semestriel';}else if(/trimestriel/i.test(nm)){freq='trimestriel';}else if(/mensuel/i.test(nm)){freq='mensuel';}}
if(!freq){return;}
var f=String(freq).toLowerCase().trim();
if(!f||typeof FREQUENCY_MULTIPLIERS==='undefined'||!FREQUENCY_MULTIPLIERS[f]){return;}
var rate;
if(typeof co==='number'){rate=co;}
else if(typeof co==='string'){rate=parseFloat(co)||0;}
else if(co&&typeof co==='object'){rate=parseFloat(co.rate||co.taux)||0;}
else if(ai.coupon){rate=parseFloat(ai.coupon.rate||ai.coupon.taux)||0;}
else{return;}
if(typeof co!=='object'||co===null){p.coupon={rate:rate};}
else{p.coupon.rate=rate;}
p.coupon.frequency=f;
if(ai.coupon&&typeof ai.coupon==='object'){
if(!p.coupon.type&&ai.coupon.type){p.coupon.type=ai.coupon.type;}
if(!p.coupon.memory&&(ai.coupon.memory||ai.coupon.memoire)){p.coupon.memory=true;}
}
console.log('[freq-fix v4] '+rate+'% x'+FREQUENCY_MULTIPLIERS[f]+' ('+f+') = '+(rate*FREQUENCY_MULTIPLIERS[f])+'%');
}
})();
