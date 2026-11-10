import { lazy, Suspense } from 'react';

export default function dynamic(load) {
  const Component = lazy(load);
  return function DeferredTool(props) {
    return <Suspense fallback={null}><Component {...props} /></Suspense>;
  };
}
