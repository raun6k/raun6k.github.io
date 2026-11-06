export interface Publication {
  id: string;
  title: string;
  authors: string[];
  venue: string;
  year: number;
  blurb: string;
  abstract: string;
  links: { label: string; href: string }[];
  bibtex: string;
}

// Newest first. Copy a block to add a paper; no CSS change needed.
export const publications: Publication[] = [
  {
    id: 'burned-cropland',
    title: 'Calibrated Weak Supervision for Post-Harvest Burned-Cropland Mapping under Label Scarcity',
    authors: ['Raunak Bhagate', 'Maitri Polisetty', 'R I Minu'],
    venue: 'ACRS 2026 (oral presentation) · arXiv:2610.05040',
    year: 2026,
    blurb:
      'Weak supervision for burned-cropland mapping when labels are scarce, from Sentinel-2 and fire detections. It held up on unseen districts and in a new state.',
    abstract:
      "Mapping post-harvest burned cropland is difficult when fires are small and fragmented and reliable labels are scarce. We developed a calibrated weak-supervision framework for Punjab, India, using Sentinel-2 spectral change, VIIRS active-fire context, and MODIS MCD64A1 as a coarse external calibration and agreement reference. Three pseudo-label recipes, five feature representations, and linear, tree-based, boosted, and neural classifiers were evaluated using nested district-held-out cross-validation over three seeds and five folds. NBR and dNBR were excluded from classifier inputs. The best configuration used the very-strict recipe, a multilayer perceptron, and the full optical feature set (mean Cohen's kappa 0.395, AUROC 0.753, F1 0.747, balanced accuracy 0.703); Random Forest, XGBoost, and LightGBM were practically tied. Higher agreement with held-out pseudo-labels did not establish improved label correctness or independent burned-area accuracy. For deployment, a Random Forest with the very-strict recipe and full optical features was retained. An externally calibrated threshold of 0.60 yielded district-level MODIS agreement of R-squared 0.636, a mapped-to-MODIS burned-area ratio of 1.005, and Spearman correlation of 0.779 with district fire counts. Pixel-level MODIS agreement remained modest (F1 0.205, kappa 0.093). Zero-shot transfer to Haryana was promising (mean kappa 0.641), but Punjab cross-year stability was weak, and Sentinel-1/Sentinel-2 feature concatenation did not improve the optical baseline. Optical observations ended before the seasonal fire context, limiting coverage of late burns. The framework supports district-scale burden assessment and hotspot screening, with limited support for exact scar boundaries or temporally stable annual mapping.",
    links: [
      { label: 'arXiv', href: 'https://arxiv.org/abs/2610.05040' },
      { label: 'PDF', href: 'https://arxiv.org/pdf/2610.05040' },
    ],
    bibtex: `@article{bhagate2026calibrated,
  title   = {Calibrated Weak Supervision for Post-Harvest Burned-Cropland Mapping under Label Scarcity},
  author  = {Bhagate, Raunak and Polisetty, Maitri and Minu, R I},
  journal = {arXiv preprint arXiv:2610.05040},
  year    = {2026}
}`,
  },
];
