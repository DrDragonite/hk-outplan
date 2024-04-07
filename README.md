# hk-outplan

## Inspiration
As explorers we often forget what to bring with ourselves to the nature and what should we pay attention to. So why use AI to remind us these features?
## What it does
Users select their date and preferred terrain. Based on that our program provides useful information to a person going outside such as what to wear, what the current weather alerts are and what the air quality is like. With this information, they can be more prepared for their tours and know what to expect outside.
## How we built it
We used ChatGPT, meteorological database provided by IBL and severe weather warnings/air pollution info given to us by weatherbit to collect and parse data into a useful format. Then we fed the data into multiple ChatGPT prompts that were at the end combined into single output.
## Challenges we ran into
Getting forecast information for future dates and engineering prompts for ChatGPT. In addition, we originally wanted to make predictions for more than 2 days, which was, due to hardware constraints impossible.
## Accomplishments that we're proud of
We have successfully implemented ChatGPT and fine-tuned its system message settings to work with meteorological data. In addition, we built a unique app we can imagine using on almost daily basis.
## What we learned
A lot about APIs (ChatGPT, IBL weather data) and other cool functionalities of the web and its technologies.
## What's next for Outdoor planner
Adding more features, more and more accurate insights into weather information. Maybe not using just an API for AI model but host our own fine-tuned model for this task. Accomplishing this was unfortunately not feasible due to the limited time constraints.
