// plugins/ml/register.js — switches on the ML activity model from ml/ (seva-ml).
//
// features.js, classifier.js, model.js in this folder are UNMODIFIED copies of
// ml/web/*.js (a test checks they are byte-identical). After retraining
// (python3 ml/retrain_from_field.py …) copy the new ml/web/model.js here:
//     cp ml/web/{features.js,classifier.js,model.js,model.json} app/plugins/ml/
//
// Feature parity: the app's pipeline hands this model the raw x/y/z samples of each
// 2-s window and the trailing 10 s of GPS (pipeline.js windowFeatures hook), and the
// model's OWN computeFeatures() turns them into its 20 features — the same code the
// model was trained with (ml/features.py ⇄ features.js parity is tested in ml/tests).

import { computeFeatures } from './features.js';
import { classify, MODEL_INFO } from './classifier.js';
import { registerClassifier } from '../../js/classifier.js';

export const mlClassifier = {
  id: MODEL_INFO.model_id,
  version: MODEL_INFO.version,
  kind: 'ml',
  info: MODEL_INFO,
  /** raw window → the model's 20 features (or null if < 16 samples) */
  windowFeatures: ({ accel, gps }) => computeFeatures(accel, gps),
  /** features.ext = output of windowFeatures; returns UNKNOWN when there is too little data */
  classify: (f) => classify(f.ext ?? null),
};

registerClassifier(mlClassifier);
