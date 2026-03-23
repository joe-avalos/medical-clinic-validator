import { SearchBar } from '../components/SearchBar.js';

export function SearchPage() {
  return (
    <div className="max-w-2xl mx-auto pt-12 animate-fade-in">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-sans font-bold text-slate-100 mb-3">
          Verify a Provider
        </h1>
        <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
          Enter a medical clinic or health system name to verify its legal registration
          status against the OpenCorporates registry.
        </p>
      </div>

      {/* Search */}
      <div className="p-6 bg-slate-850 border border-slate-800 rounded-xl shadow-2xl shadow-black/20">
        <SearchBar />
      </div>

      {/* How it works */}
      <div className="mt-12 grid grid-cols-3 gap-6">
        {[
          {
            step: '01',
            title: 'Search',
            desc: 'Query the OpenCorporates registry for legal entity data',
          },
          {
            step: '02',
            title: 'Analyze',
            desc: 'AI validates registration status and assesses risk level',
          },
          {
            step: '03',
            title: 'Store',
            desc: 'Results persisted for audit trail and future reference',
          },
        ].map((item, i) => (
          <div
            key={item.step}
            className={`animate-fade-in stagger-${i + 1}`}
          >
            <div className="text-xs font-mono text-accent mb-2">{item.step}</div>
            <div className="text-sm font-semibold text-slate-300 mb-1">{item.title}</div>
            <div className="text-xs text-slate-500 leading-relaxed">{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}