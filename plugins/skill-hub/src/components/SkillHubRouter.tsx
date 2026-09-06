import { Route, Routes } from 'react-router-dom';
import { AssetPage } from './AssetPage';
import { BrowsePage } from './BrowsePage';

/** Browse at the plugin root, one asset at `<kind>/<namespace>/<name>`. */
export const SkillHubRouter = () => (
  <Routes>
    <Route path="/" element={<BrowsePage />} />
    <Route path=":kind/:namespace/:name" element={<AssetPage />} />
  </Routes>
);
