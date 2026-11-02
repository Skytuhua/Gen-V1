# Third-party notices

Gen V1 is a separate application. The following projects retain their own
copyright and license terms; the first-party licensing notice does not replace
or restrict the rights their licenses grant.

| Component | Provenance | License and notice |
| --- | --- | --- |
| Original Hermes Agent engine, learning and skills | Nous Research; commit `c627ec84664d43e0b18b95d9d86d8963747d56c7` | [MIT notice](third-party/hermes-agent/LICENSE), [integration and source manifest](third-party/hermes-agent/README.md) |
| Identified T3 Code account and interface components | T3 Tools Inc.; commit `8760d063e903406c8e8f695b0852c0a15fc1e00f` | [MIT notice](third-party/t3code/LICENSE), [adaptation inventory](third-party/t3code/README.md) |

The retained original Hermes files are an unchanged subset of the pinned source.
Host transport and permission integration live outside that upstream tree. The
source manifests record exact paths and hashes.

The application also uses the packages pinned in [package.json](package.json),
[pnpm-lock.yaml](pnpm-lock.yaml) and the [Python runtime requirements](third-party/hermes-agent/runtime-requirements.txt).
Their authors retain the licenses distributed with those packages. Published
provider runtimes and SDKs remain governed by their respective terms; their
presence does not imply endorsement or account entitlement.

Historical comparison frames under `docs/reference/` depict their original
owners' products and are identified in [the reference inventory](docs/reference-videos.md).
They are reference material, not Gen V1 product screenshots. Current product
screenshots live in `docs/screenshots/` and describe their sample-data scope.
