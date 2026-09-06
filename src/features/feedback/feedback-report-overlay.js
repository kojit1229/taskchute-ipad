import {validDate} from './feedback-result.js';
// AI-report overlay owns only reading dates; it never changes the journal's selected date.
export function createFeedbackReportOverlay({gateway,controller,view,escapeHTML:e,getCanonicalFiles,getCanonicalBody,onUpdate}={}) {
 if(!gateway||!controller||typeof view!=='function'||typeof getCanonicalFiles!=='function'||typeof getCanonicalBody!=='function'||typeof onUpdate!=='function')throw Error('overlay_configuration');
 let generation=null,epoch=0,queueDates=[],selected=null,error=false;
 function check(){const key=gateway.key();if(key!==generation){generation=key;epoch++;queueDates=[];selected=null;error=false;}return key;}
 function dates(){check();return [...new Set([...(getCanonicalFiles()||[]).map(x=>x.date),...queueDates])].filter(validDate).sort().reverse();}
 function select(date){if(!validDate(date))throw Error('invalid_date');check();selected=date;controller.selectDate(date);onUpdate();}
 return {
  dates,select,
  async refresh(){const key=check(),run=++epoch;try{const next=await gateway.dates();if(gateway.key()!==key||run!==epoch)return;queueDates=next;error=false;
   if(!selected&&dates().length)select(dates()[0]);if(selected){controller.selectDate(selected);await controller.refresh();}
  }catch{if(gateway.key()!==key||run!==epoch)return;error=true;}if(gateway.key()===key&&run===epoch)onUpdate();},
  render(){const all=dates();if(!selected&&all.length){selected=all[0];controller.selectDate(selected);}
   if(!selected)return '<div data-feedback-report-overlay><p>対象日をまだ確認できていません。</p><button class="btn ghost" type="button" data-action="feedback-report-refresh">一覧を確認</button></div>';
   const snapshot=controller.snapshot();
   if(snapshot.date!==selected)return '<div data-feedback-report-overlay><p>選択日の状態を確認できません。一覧を更新してください。</p><button class="btn ghost" type="button" data-action="feedback-report-refresh">一覧を更新</button></div>';
   const file=(getCanonicalFiles()||[]).find(x=>x.date===selected),body=file?getCanonicalBody(file):null;
   const choices=[...new Set([selected,...all])].sort().reverse().map(date=>`<button class="btn ghost" type="button" data-action="feedback-report-date" data-feedback-date="${e(date)}" aria-pressed="${date===selected}" style="min-height:44px">${e(date)}</button>`).join('');
   return `<div data-feedback-report-overlay><div class="feedback-controls">${choices}</div><button class="btn ghost" type="button" data-action="feedback-report-refresh">一覧を更新</button>`+
    (error?'<p>一覧を確認できません。前回の対象日を表示しています。</p>':'')+
    view({...snapshot,readOnly:true,originalFile:file?.name||null},body)+
    `<p>追記して依頼する場合は、ジャーナルで ${e(selected)} を開いてください。</p></div>`;
  }
 };
}
