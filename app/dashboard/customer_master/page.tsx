'use client';

import React, { useState } from 'react';

const zoneData = {
  storage: {
    title: 'Tank Farm (Area Penyimpanan)',
    description: 'Fasilitas tangki penyimpanan minyak mentah. Dilengkapi dengan tanggul penahan (bund wall) untuk standar keamanan ganda.',
    status: 'Normal',
    capacity: '85% Penuh',
  },
  processing: {
    title: 'Processing Unit (Unit Distilasi)',
    description: 'Area pemrosesan utama. Terdiri dari menara distilasi fraksional, heat exchanger, dan jaringan pipa kompleks (pipe racks).',
    status: 'Maintenance Lini 2',
    capacity: 'Beroperasi 100%',
  },
  loading: {
    title: 'Marine Loading Jetty',
    description: 'Dermaga laut dalam tempat kapal tanker bersandar (berthing) untuk proses bongkar muat minyak.',
    status: 'Sibuk',
    capacity: '1 Tanker VLCC Bersandar',
  },
  utilities: {
    title: 'Utilities & Flare System',
    description: 'Pembangkit listrik internal, sistem pendingin air, dan menara suar darurat (flare stack).',
    status: 'Normal',
    capacity: 'Stabil',
  }
};

export default function RealisticRefineryMap() {
  const [activeZone, setActiveZone] = useState(null);

  // Helper untuk menentukan opacity jika ada zona yang dipilih
  const getZoneClass = (zoneName) => {
    const baseClass = "cursor-pointer transition-all duration-300 outline-none";
    if (!activeZone) return `${baseClass} hover:brightness-110`;
    return activeZone === zoneName 
      ? `${baseClass} brightness-110 drop-shadow-lg` 
      : `${baseClass} opacity-40 grayscale-[50%]`;
  };

  return (
    <div className="flex flex-col xl:flex-row gap-6 p-6 bg-slate-900 min-h-screen text-slate-200">
      
      {/* BAGIAN KIRI: SVG PETA REALISTIS */}
      <div className="flex-1">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white tracking-wide">Terminal Overview</h2>
          <p className="text-slate-400 mt-1">Live Architectural Top-Down View. Klik pada zona operasi.</p>
        </div>
        
        {/* SVG Container - Menggunakan aspect ratio */}
        <div className="bg-slate-800 p-2 rounded-xl shadow-2xl border border-slate-700 overflow-hidden">
          <svg viewBox="0 0 1000 700" className="w-full h-auto">
            
            {/* DEFINISI EFEK (Gradients & Shadows) */}
            <defs>
              {/* Efek 3D untuk Tangki Silinder (Top-down view) */}
              <radialGradient id="tankGradient" cx="30%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="70%" stopColor="#94a3b8" />
                <stop offset="100%" stopColor="#475569" />
              </radialGradient>
              
              {/* Efek 3D untuk Tangki Minyak Mentah (Gelap) */}
              <radialGradient id="crudeTankGradient" cx="30%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#64748b" />
                <stop offset="80%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#0f172a" />
              </radialGradient>

              {/* Gradient Air Laut */}
              <linearGradient id="waterGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0369a1" />
                <stop offset="100%" stopColor="#082f49" />
              </linearGradient>

              {/* Drop Shadow untuk bangunan */}
              <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="5" dy="8" stdDeviation="4" floodColor="#000000" floodOpacity="0.5"/>
              </filter>
              
              {/* Drop Shadow Ringan */}
              <filter id="lightShadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="2" dy="4" stdDeviation="2" floodColor="#000000" floodOpacity="0.4"/>
              </filter>
            </defs>

            {/* BASE TERRAIN (Tanah Daratan) */}
            <rect width="1000" height="700" fill="#1e293b" />
            
            {/* JARINGAN JALAN (Roads) */}
            <path d="M 0,350 L 1000,350 M 450,0 L 450,700 M 750,0 L 750,350" 
                  stroke="#334155" strokeWidth="24" strokeLinecap="square" />
            {/* Garis marka jalan */}
            <path d="M 0,350 L 1000,350 M 450,0 L 450,700 M 750,0 L 750,350" 
                  stroke="#475569" strokeWidth="2" strokeDasharray="10,10" />

            {/* MAIN PIPE RACK (Jaringan Pipa Utama) */}
            <g stroke="#64748b" strokeWidth="3" fill="none">
              <path d="M 380,150 L 380,550 L 500,550" />
              <path d="M 390,150 L 390,540 L 500,540" />
              <path d="M 400,150 L 400,530 L 500,530" />
            </g>


            {/* =========================================
                ZONA 1: STORAGE TANK FARM
            ========================================= */}
            <g onClick={() => setActiveZone('storage')} className={getZoneClass('storage')}>
              {/* Bund Wall (Tanggul Beton) */}
              <rect x="40" y="40" width="360" height="270" fill="#0f172a" stroke="#475569" strokeWidth="6" rx="8" />
              <text x="60" y="75" className="text-sm font-bold tracking-widest" fill="#64748b">TANK FARM AREA A</text>
              
              {/* Pipa cabang ke tangki */}
              <path d="M 380,120 L 140,120 M 380,220 L 140,220" stroke="#475569" strokeWidth="4" />

              {/* Tangki-tangki (Menggunakan radial gradient untuk efek 3D silinder) */}
              <circle cx="140" cy="120" r="50" fill="url(#tankGradient)" filter="url(#dropShadow)" />
              <circle cx="280" cy="120" r="50" fill="url(#tankGradient)" filter="url(#dropShadow)" />
              <circle cx="140" cy="230" r="50" fill="url(#crudeTankGradient)" filter="url(#dropShadow)" />
              <circle cx="280" cy="230" r="50" fill="url(#crudeTankGradient)" filter="url(#dropShadow)" />
              
              {/* Tangga atap tangki (Detail kecil) */}
              <path d="M 140,120 L 140,170 M 280,120 L 280,170" stroke="#cbd5e1" strokeWidth="1.5" />
            </g>


            {/* =========================================
                ZONA 2: PROCESSING UNIT
            ========================================= */}
            <g onClick={() => setActiveZone('processing')} className={getZoneClass('processing')}>
              {/* Area Base Beton */}
              <rect x="500" y="40" width="460" height="270" fill="#1e293b" stroke="#334155" strokeWidth="4" />
              <text x="520" y="75" className="text-sm font-bold tracking-widest" fill="#64748b">PROCESSING & DISTILLATION</text>

              {/* Struktur Pipa Kompleks (Pipe Grids) */}
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#334155" strokeWidth="1"/>
              </pattern>
              <rect x="520" y="100" width="200" height="150" fill="url(#grid)" />

              {/* Distillation Towers (Menara) */}
              <rect x="560" y="120" width="30" height="110" fill="url(#tankGradient)" filter="url(#dropShadow)" rx="15" />
              <rect x="620" y="90" width="40" height="150" fill="url(#tankGradient)" filter="url(#dropShadow)" rx="20" />
              <rect x="750" y="100" width="160" height="60" fill="#475569" filter="url(#lightShadow)" /> {/* Heat Exchanger */}
              <rect x="750" y="180" width="160" height="60" fill="#475569" filter="url(#lightShadow)" />
              
              {/* Cerobong Kecil */}
              <circle cx="575" cy="175" r="8" fill="#1e293b" />
              <circle cx="640" cy="165" r="12" fill="#1e293b" />
            </g>


            {/* =========================================
                ZONA 3: MARINE LOADING JETTY (Air & Kapal)
            ========================================= */}
            <g onClick={() => setActiveZone('loading')} className={getZoneClass('loading')}>
              {/* Area Air Laut */}
              <rect x="0" y="450" width="1000" height="250" fill="url(#waterGradient)" />
              
              {/* Gelombang Air (Detail dekoratif) */}
              <path d="M 100,500 Q 120,490 140,500 T 180,500 M 800,600 Q 820,590 840,600 T 880,600" fill="none" stroke="#0ea5e9" strokeWidth="2" opacity="0.3" />

              {/* Dermaga Beton (Jetty Structure) */}
              <path d="M 450,350 L 450,550 L 300,550 L 300,580 L 600,580 L 600,550 L 480,550 L 480,350 Z" fill="#94a3b8" filter="url(#dropShadow)" />
              <text x="460" y="540" className="text-xs font-bold" fill="#0f172a">MAIN JETTY 01</text>
              
              {/* Loading Arms (Pemuat ke Kapal) */}
              <path d="M 350,580 L 350,610 M 450,580 L 450,610 M 550,580 L 550,610" stroke="#f59e0b" strokeWidth="6" />

              {/* Kapal Tanker (VLCC) */}
              <g filter="url(#dropShadow)" transform="translate(150, 610)">
                {/* Lambung Kapal */}
                <path d="M 0,20 L 50,0 L 550,0 L 600,20 L 600,60 L 550,80 L 50,80 L 0,60 Z" fill="#b91c1c" />
                {/* Deck Kapal */}
                <path d="M 5,25 L 50,5 L 550,5 L 595,25 L 595,55 L 550,75 L 50,75 L 5,55 Z" fill="#334155" />
                {/* Bridge / Ruang Kemudi (Belakang) */}
                <rect x="480" y="15" width="80" height="50" fill="#f8fafc" rx="2" />
                <circle cx="540" cy="40" r="10" fill="#ef4444" /> {/* Helipad */}
                {/* Deck Piping / Manifold */}
                <rect x="100" y="35" width="300" height="10" fill="#64748b" />
              </g>
            </g>


            {/* =========================================
                ZONA 4: UTILITIES & FLARE
            ========================================= */}
            <g onClick={() => setActiveZone('utilities')} className={getZoneClass('utilities')}>
              {/* Area Base */}
              <rect x="40" y="380" width="360" height="60" fill="#1e293b" stroke="#334155" strokeWidth="4" />
              <text x="60" y="415" className="text-sm font-bold tracking-widest" fill="#64748b">POWER & UTILITIES</text>

              {/* Area Flare */}
              <rect x="800" y="380" width="160" height="60" fill="#1e293b" stroke="#334155" strokeWidth="4" />
              
              {/* Power Generator Blocks */}
              <rect x="250" y="390" width="40" height="40" fill="#475569" filter="url(#lightShadow)" />
              <rect x="310" y="390" width="40" height="40" fill="#475569" filter="url(#lightShadow)" />

              {/* Flare Stack (Menara Api dari atas) */}
              <circle cx="880" cy="410" r="15" fill="#475569" filter="url(#dropShadow)" />
              {/* Efek Api (Glow) */}
              <circle cx="880" cy="410" r="8" fill="#f97316">
                <animate attributeName="r" values="6;10;6" dur="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;1;0.8" dur="1s" repeatCount="indefinite" />
              </circle>
              <circle cx="880" cy="410" r="4" fill="#fef08a" />
              
              <text x="820" y="460" className="text-xs font-bold" fill="#64748b">FLARE STACK</text>
            </g>

          </svg>
        </div>
      </div>

      {/* BAGIAN KANAN: PANEL INFORMASI (Dark Mode Themed) */}
      <div className="w-full xl:w-[400px]">
        <div className="bg-slate-800 p-6 rounded-xl shadow-xl border border-slate-700 h-full">
          {activeZone ? (
            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex items-center gap-3 border-b border-slate-700 pb-4 mb-5">
                <div className={`w-3 h-3 rounded-full ${zoneData[activeZone].status === 'Normal' ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`}></div>
                <h3 className="text-xl font-bold text-white">
                  {zoneData[activeZone].title}
                </h3>
              </div>
              
              <p className="text-slate-400 mb-8 leading-relaxed text-sm">
                {zoneData[activeZone].description}
              </p>
              
              <div className="space-y-4">
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                  <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Status Sistem</span>
                  <span className={`text-lg font-bold ${zoneData[activeZone].status === 'Normal' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {zoneData[activeZone].status}
                  </span>
                </div>
                
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                  <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Beban Operasional</span>
                  <span className="text-lg font-bold text-cyan-400">
                    {zoneData[activeZone].capacity}
                  </span>
                </div>
              </div>

              <button 
                onClick={() => setActiveZone(null)}
                className="mt-8 w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors text-sm font-semibold"
              >
                Reset Pemilihan
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-60 py-20">
              <svg className="w-20 h-20 text-slate-500 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <p className="text-lg font-medium text-slate-300">
                Pilih zona operasi di layar monitor.
              </p>
              <p className="text-sm text-slate-500 mt-2">
                Sistem menunggu input operator...
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}