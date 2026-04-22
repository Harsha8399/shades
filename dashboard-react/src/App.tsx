import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components';
import { Dashboard, Trades, Patterns, Analysis } from './pages';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/patterns" element={<Patterns />} />
          <Route path="/analysis" element={<Analysis />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
