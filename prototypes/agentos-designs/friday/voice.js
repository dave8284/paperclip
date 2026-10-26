/**
 * Browser voice for a design preview. Navigation and replies use local fixtures.
 * Recognition may use the browser's speech provider; no paid model is connected.
 */
export function createVoice({onState,onInterim,onUtterance}) {
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const synthesis=window.speechSynthesis;
  let recognition=null,utterance=null,armed=false,generation=0,restart=null,watchdog=null,speakReplies=true;
  function clear(){clearTimeout(restart);clearTimeout(watchdog);}
  function stopRecognition(){
    const current=recognition;recognition=null;
    if(current){current.onstart=null;current.onresult=null;current.onend=null;current.onerror=null;try{current.abort();}catch{/* Already ended. */}}
  }
  function stopSpeech(){
    if(utterance){utterance.onend=null;utterance.onerror=null;utterance.onstart=null;utterance=null;synthesis?.cancel();}
  }
  function stop(message='Voice paused. Here when you need me.'){
    generation++;armed=false;clear();stopRecognition();stopSpeech();onInterim('');onState('ready',message);
  }
  function fail(message){stop(message);onState('error',message);}
  function listen(){
    if(!Recognition){fail('Voice input isn’t supported here. You can type or try a suggested request.');return;}
    if(document.hidden){stop();return;}
    clear();stopRecognition();stopSpeech();
    const current=new Recognition(), token=generation;
    recognition=current;let final='',hadError=false;
    current.lang=navigator.language||'en-US';current.continuous=false;current.interimResults=true;
    onState('requesting','Allow the microphone to start listening.');
    watchdog=setTimeout(()=>{if(recognition===current)fail('The microphone did not start. Try again or type.');},15000);
    current.onstart=()=>{
      if(recognition!==current)return;
      clearTimeout(watchdog);onState('listening','Listening. Go ahead.');
      watchdog=setTimeout(()=>{if(recognition===current){try{current.stop();}catch{stop();}}},45000);
    };
    current.onresult=event=>{
      if(recognition!==current)return;
      let partial='';final='';
      for(let i=0;i<event.results.length;i++){
        const result=event.results[i];
        if(result.isFinal)final+=result[0].transcript+' ';else partial+=result[0].transcript;
      }
      onInterim((final+partial).trim());
      if(final.trim())current.stop();
    };
    current.onerror=event=>{
      if(recognition!==current)return;
      hadError=true;
      const messages={
        'not-allowed':'Microphone access was denied. Allow it in your browser settings, or type.',
        'service-not-allowed':'Browser speech recognition is unavailable. You can still type.',
        'audio-capture':'No microphone was found. Connect one, or type.',
        'network':'Voice connection failed. Try again or type.',
        'no-speech':'I didn’t catch anything. Tap the microphone to try again.',
        'aborted':'Voice paused.'
      };
      fail(messages[event.error]||'Voice input stopped. Try again or type.');
    };
    current.onend=()=>{
      if(recognition!==current)return;
      recognition=null;clearTimeout(watchdog);
      if(token!==generation||hadError)return;
      onInterim('');
      if(final.trim()){onState('thinking','One moment…');onUtterance(final.trim(),true);}
      else {armed=false;onState('ready','I didn’t catch anything. Tap to try again.');}
    };
    try{current.start();}catch{fail('Voice could not start. Try again or type.');}
  }
  function resume(){
    if(armed&&!document.hidden)restart=setTimeout(listen,450);
    else onState('ready','Here when you need me');
  }
  function respond(text,{spoken=false}={}){
    const token=++generation;clear();stopRecognition();stopSpeech();onInterim('');
    if(!spoken)armed=false;
    if(!speakReplies||!synthesis){if(spoken&&!synthesis){armed=false;onState('error','Spoken replies are unavailable here. Your reply is in the transcript.');}else resume();return;}
    const next=new SpeechSynthesisUtterance(text);utterance=next;
    const voices=synthesis.getVoices();
    const local=voices.find(v=>v.localService&&/^en\b/.test(v.lang));
    if(local)next.voice=local;
    next.rate=1;next.pitch=1;
    onState('thinking','Preparing a spoken reply…');
    watchdog=setTimeout(()=>{if(utterance===next)fail('Audio did not start. The reply is in your transcript.');},8000);
    next.onstart=()=>{
      if(token!==generation)return;
      clearTimeout(watchdog);onState('speaking','Speaking. Tap the microphone to interrupt.');
      watchdog=setTimeout(()=>{if(utterance===next)fail('Audio playback stopped. The reply is in your transcript.');},60000);
    };
    next.onend=()=>{
      if(token!==generation)return;
      clearTimeout(watchdog);utterance=null;resume();
    };
    next.onerror=event=>{
      if(token!==generation)return;
      clearTimeout(watchdog);utterance=null;
      if(event.error==='interrupted'||event.error==='canceled'){resume();return;}
      fail('Spoken playback is unavailable. Your reply is in the transcript.');
    };
    synthesis.speak(next);
  }
  function toggle(){
    if(armed||recognition||utterance){stop();return;}
    generation++;armed=true;listen();
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Voice paused while this tab is away.');});
  window.addEventListener('pagehide',()=>stop());
  return {toggle,stop,respond,setSpeakReplies(value){speakReplies=value;if(!value&&utterance){stopSpeech();clearTimeout(watchdog);resume();}},get active(){return armed||!!recognition||!!utterance;}};
}
