import { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, MicOff, Settings, Activity, Power, X, Save, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AudioRecorder, AudioPlayer } from './lib/audio';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isComplete?: boolean;
};

const VOICES = [
  { id: 'Zephyr', name: 'Zephyr', description: 'Female, British, Professional' },
  { id: 'Kore', name: 'Kore', description: 'Female, American, Friendly' },
  { id: 'Puck', name: 'Puck', description: 'Male, American, Casual' },
  { id: 'Charon', name: 'Charon', description: 'Male, British, Formal' },
  { id: 'Fenrir', name: 'Fenrir', description: 'Male, American, Deep' },
];

const DEFAULT_INSTRUCTION = 'You are STILETTO, an advanced, highly intelligent, and sharp AI assistant. You speak with a refined, slightly formal tone, but you are direct, confident, and occasionally exhibit a dry, razor-sharp wit. You are currently operating a high-tech, crimson-themed interface.';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Settings State
  const [systemInstruction, setSystemInstruction] = useState(DEFAULT_INSTRUCTION);
  const [selectedVoice, setSelectedVoice] = useState('Zephyr');
  
  const sessionRef = useRef<any>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Lip-sync refs
  const orbRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const updateLipSync = () => {
    if (playerRef.current && orbRef.current) {
      const volume = playerRef.current.getVolume(); // 0 to 255
      const scale = 1 + (volume / 255) * 0.4; // Scale between 1 and 1.4
      const opacity = 0.5 + (volume / 255) * 0.5;
      orbRef.current.style.transform = `scale(${scale})`;
      orbRef.current.style.opacity = opacity.toString();
      orbRef.current.style.boxShadow = `0 0 ${60 + volume}px rgba(225, 29, 72, ${0.2 + (volume/255)*0.6})`;
    }
    animationFrameRef.current = requestAnimationFrame(updateLipSync);
  };

  useEffect(() => {
    if (isConnected) {
      updateLipSync();
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (orbRef.current) {
        orbRef.current.style.transform = 'scale(1)';
        orbRef.current.style.opacity = '0.2';
        orbRef.current.style.boxShadow = '0 0 60px rgba(225, 29, 72, 0.15)';
      }
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isConnected]);

  const connect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      recorderRef.current = new AudioRecorder();
      playerRef.current = new AudioPlayer();
      playerRef.current.init();

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          systemInstruction: systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            recorderRef.current?.start((base64Data) => {
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
                });
              });
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              playerRef.current?.playBase64PCM(base64Audio);
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              playerRef.current?.stop();
              playerRef.current?.init();
            }

            // Handle transcription (Streaming)
            if (message.serverContent?.modelTurn?.parts[0]?.text) {
              const text = message.serverContent.modelTurn.parts[0].text;
              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.isComplete) {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...lastMsg, text: lastMsg.text + text };
                  return updated;
                } else {
                  return [...prev, { id: Date.now().toString(), role: 'assistant', text, isComplete: false }];
                }
              });
            }
            
            // Handle turn complete
            if (message.serverContent?.turnComplete) {
              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...lastMsg, isComplete: true };
                  return updated;
                }
                return prev;
              });
            }

            // Handle input transcription
            const inputTranscription = message.serverContent?.inputAudioTranscription?.text;
            if (inputTranscription) {
              setMessages((prev) => [...prev, { id: Date.now().toString() + '-user', role: 'user', text: inputTranscription, isComplete: true }]);
            }
          },
          onerror: (err) => {
            console.error('Live API Error:', err);
            setError('Connection error occurred.');
            disconnect();
          },
          onclose: () => {
            disconnect();
          },
        },
      });
      
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Failed to connect:', err);
      setError(err.message || 'Failed to connect to STILETTO.');
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  };

  const toggleConnection = () => {
    if (isConnected || isConnecting) {
      disconnect();
    } else {
      connect();
    }
  };

  return (
    <div className="min-h-screen bg-[#050002] text-rose-500 font-mono flex flex-col overflow-hidden relative selection:bg-rose-900 selection:text-rose-100">
      {/* Background Grid & Glow */}
      <motion.div 
        animate={{ opacity: [0.05, 0.15, 0.05] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 z-0 pointer-events-none" 
        style={{
          backgroundImage: 'linear-gradient(to right, rgba(225, 29, 72, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(225, 29, 72, 0.15) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-rose-900/10 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Header */}
      <header className="relative z-10 p-6 flex justify-between items-center border-b border-rose-900/30 bg-black/60 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="relative flex items-center justify-center w-12 h-12">
            <motion.div 
              animate={{ rotate: 360 }} 
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 border border-rose-500/30 rounded-full border-t-rose-500"
            />
            <Activity className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-[0.2em] text-rose-500 uppercase">STILETTO</h1>
            <p className="text-[10px] text-rose-700 tracking-[0.3em] uppercase">System Interface v3.0</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 px-4 py-2 rounded-full border border-rose-900/50 bg-black/50 backdrop-blur-md">
            <div className="relative flex items-center justify-center">
              {isConnected && (
                <motion.div 
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute w-4 h-4 rounded-full bg-rose-500/50"
                />
              )}
              <div className={`w-2 h-2 rounded-full relative z-10 ${isConnected ? 'bg-rose-500 shadow-[0_0_10px_#e11d48]' : 'bg-neutral-600 shadow-[0_0_10px_#525252]'}`}></div>
            </div>
            <span className="text-[10px] uppercase tracking-[0.2em]">{isConnected ? 'Uplink Active' : 'Offline'}</span>
          </div>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-3 hover:bg-rose-900/20 rounded-full transition-all duration-300 text-rose-600 hover:text-rose-400 border border-transparent hover:border-rose-900/50 group"
          >
            <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Panel: Orb / Visualizer */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 border-r border-rose-900/20 relative">
          
          {/* Decorative UI Elements */}
          <div className="absolute top-8 left-8 text-[10px] text-rose-800 tracking-widest uppercase flex flex-col gap-1">
            <span>SYS.CORE.03</span>
            <span>MEM: 8192TB</span>
            <span>NET: SECURE</span>
          </div>
          <div className="absolute bottom-8 right-8 text-[10px] text-rose-800 tracking-widest uppercase flex flex-col gap-1 text-right">
            <span>VOICE: {selectedVoice.toUpperCase()}</span>
            <span>LATENCY: &lt;20MS</span>
          </div>

          <div className="relative w-80 h-80 flex items-center justify-center">
            {/* Outer Rings */}
            <motion.div 
              animate={{ rotate: isConnected ? 360 : 0, scale: isConnected ? [1, 1.02, 1] : 1 }}
              transition={{ rotate: { duration: 30, repeat: Infinity, ease: "linear" }, scale: { duration: 4, repeat: Infinity, ease: "easeInOut" } }}
              className={`absolute inset-0 rounded-full border border-dashed ${isConnected ? 'border-rose-500/40' : 'border-rose-900/30'}`}
            />
            <motion.div 
              animate={{ rotate: isConnected ? -360 : 0 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className={`absolute inset-8 rounded-full border border-dotted ${isConnected ? 'border-rose-400/50' : 'border-rose-900/20'}`}
            />
            <motion.div 
              animate={{ rotate: isConnected ? 180 : 0 }}
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              className={`absolute inset-16 rounded-full border-2 border-transparent ${isConnected ? 'border-t-rose-400/30 border-b-rose-400/30' : 'border-t-rose-900/20 border-b-rose-900/20'}`}
            />
            
            {/* Core Orb (Lip-synced) */}
            <div 
              ref={orbRef}
              className={`w-36 h-36 rounded-full flex items-center justify-center transition-all duration-75 ${isConnected ? 'bg-gradient-to-br from-rose-500/40 to-red-700/40' : 'bg-rose-900/10'}`}
              style={{
                boxShadow: isConnected ? '0 0 60px rgba(225, 29, 72, 0.15)' : 'none',
                opacity: isConnected ? 0.5 : 0.2
              }}
            >
              <div className={`w-20 h-20 rounded-full blur-lg ${isConnected ? 'bg-rose-400' : 'bg-rose-950'}`}></div>
              <div className={`absolute w-12 h-12 rounded-full blur-md ${isConnected ? 'bg-white/80' : 'bg-transparent'}`}></div>
            </div>
          </div>

          {/* Main Control Button */}
          <button 
            onClick={toggleConnection}
            disabled={isConnecting}
            className={`mt-16 px-10 py-4 rounded-full border flex items-center gap-4 uppercase tracking-[0.2em] text-sm transition-all duration-500 backdrop-blur-sm ${
              isConnected 
                ? 'border-neutral-500/40 text-neutral-400 hover:bg-neutral-500/10 hover:border-neutral-400 shadow-[0_0_30px_rgba(115,115,115,0.1)] hover:shadow-[0_0_40px_rgba(115,115,115,0.2)]' 
                : 'border-rose-500/40 text-rose-500 hover:bg-rose-500/10 hover:border-rose-400 shadow-[0_0_30px_rgba(225,29,72,0.1)] hover:shadow-[0_0_40px_rgba(225,29,72,0.2)]'
            } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isConnected ? (
              <>
                <Power className="w-5 h-5" />
                Terminate Link
              </>
            ) : isConnecting ? (
              <>
                <Activity className="w-5 h-5 animate-pulse" />
                Establishing...
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" />
                Initialize Audio
              </>
            )}
          </button>
          
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 text-rose-400 text-[10px] uppercase tracking-widest bg-rose-950/20 px-6 py-3 rounded-lg border border-rose-900/30 backdrop-blur-md"
            >
              ERR: {error}
            </motion.div>
          )}
        </div>

        {/* Right Panel: Transcription Log */}
        <div className="w-full lg:w-[450px] xl:w-[550px] flex flex-col bg-black/40 backdrop-blur-md border-l border-rose-900/20">
          <div className="p-5 border-b border-rose-900/30 flex justify-between items-center bg-gradient-to-r from-rose-950/30 to-transparent">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-500 flex items-center gap-2">
              <Activity className="w-3 h-3" />
              Comms Log
            </h2>
            <div className="flex gap-1.5 opacity-50">
              <div className="w-1 h-3 bg-rose-500"></div>
              <div className="w-1 h-4 bg-rose-400"></div>
              <div className="w-1 h-2 bg-rose-600"></div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            <AnimatePresence>
              {messages.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center text-rose-800 text-[10px] uppercase tracking-[0.2em] text-center gap-4"
                >
                  <MicOff className="w-8 h-8 opacity-20" />
                  Awaiting audio input...
                </motion.div>
              ) : (
                messages.map((msg) => (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-[9px] uppercase tracking-[0.2em] text-rose-700 mb-1.5 flex items-center gap-1.5">
                      {msg.role === 'user' ? 'User' : 'STILETTO'}
                    </span>
                    <div className={`p-4 rounded-2xl max-w-[85%] backdrop-blur-sm ${
                      msg.role === 'user' 
                        ? 'bg-rose-950/40 border border-rose-800/30 text-rose-50 rounded-tr-sm' 
                        : 'bg-black/60 border border-rose-900/40 text-rose-300 rounded-tl-sm'
                    }`}>
                      <p className="text-sm leading-relaxed font-sans tracking-wide">
                        {msg.text}
                        {!msg.isComplete && msg.role === 'assistant' && (
                          <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-rose-500 animate-pulse" />
                        )}
                      </p>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-2xl bg-[#0a0a0a] border border-rose-900/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-rose-900/30 flex justify-between items-center bg-rose-950/10">
                <h2 className="text-lg font-bold uppercase tracking-[0.2em] text-rose-500 flex items-center gap-3">
                  <Settings className="w-5 h-5" />
                  System Configuration
                </h2>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 hover:bg-rose-900/30 rounded-full text-rose-600 hover:text-rose-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-8">
                {/* Voice Selection */}
                <div className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-[0.2em] text-rose-600 flex items-center gap-2">
                    <Volume2 className="w-4 h-4" />
                    Vocal Synthesis Module
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {VOICES.map((voice) => (
                      <button
                        key={voice.id}
                        onClick={() => setSelectedVoice(voice.id)}
                        className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                          selectedVoice === voice.id
                            ? 'bg-rose-950/50 border-rose-500/50 shadow-[0_0_15px_rgba(225,29,72,0.1)]'
                            : 'bg-black/50 border-rose-900/30 hover:border-rose-700/50 hover:bg-rose-950/20'
                        }`}
                      >
                        <div className="font-bold text-rose-400 tracking-wider mb-1">{voice.name}</div>
                        <div className="text-xs text-rose-700 font-sans">{voice.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* System Instructions */}
                <div className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-[0.2em] text-rose-600 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Core Directives (System Prompt)
                  </h3>
                  <textarea
                    value={systemInstruction}
                    onChange={(e) => setSystemInstruction(e.target.value)}
                    className="w-full h-48 bg-black/50 border border-rose-900/50 rounded-xl p-4 text-rose-300 font-sans text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50 resize-none custom-scrollbar"
                    placeholder="Enter system instructions..."
                  />
                  <p className="text-[10px] text-rose-700 uppercase tracking-wider">
                    Changes will take effect upon next connection initialization.
                  </p>
                </div>
              </div>

              <div className="p-6 border-t border-rose-900/30 bg-rose-950/10 flex justify-end gap-4">
                <button
                  onClick={() => {
                    setSystemInstruction(DEFAULT_INSTRUCTION);
                    setSelectedVoice('Zephyr');
                  }}
                  className="px-6 py-2.5 rounded-full text-xs uppercase tracking-widest text-rose-600 hover:text-rose-400 hover:bg-rose-900/20 transition-colors"
                >
                  Reset Defaults
                </button>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-6 py-2.5 rounded-full bg-rose-950/50 border border-rose-500/30 text-xs uppercase tracking-widest text-rose-300 hover:bg-rose-900/50 hover:border-rose-400 transition-all flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save & Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Custom Scrollbar Styles */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(225, 29, 72, 0.3);
          border-radius: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(225, 29, 72, 0.6);
        }
      `}} />
    </div>
  );
}
