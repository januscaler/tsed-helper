# Tsed Helper

This package is a collection of decorators,utilities and services that can be used to simplify the development of Tsed backend applications.(microservice)

## Installation

```bash
npm install @januscaler/tsed-helper
```

## Usage
 ### Range Search
  ```typescript
//   for numbers
  {
    "field":{
        mode:"RG",
        value:[5,30]
    }
  }
  //   for date
  {
    "field":{
        "mode":"RG",
       "value":["2024-10-13T16:15:57.132Z","2024-10-13T16:15:57.132Z"]
    }
  }
  ```
