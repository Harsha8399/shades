import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components';
import { Dashboard, Trades, Patterns, Analysis, PaperTrading } from './pages';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/patterns" element={<Patterns />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/paper-trading" element={<PaperTrading />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
